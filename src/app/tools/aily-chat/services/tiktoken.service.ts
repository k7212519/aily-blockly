import { Injectable } from '@angular/core';

/**
 * TikToken 精确分词服务
 *
 * 使用 js-tiktoken (纯 JS，无 WASM) 提供精确的 token 计数。
 * 采用 o200k_base 编码，覆盖 GPT-4o / Claude / DeepSeek / Qwen 等现代模型。
 *
 * 加载策略（混合模式）：
 * 1. 优先从本地 assets/tiktoken/ 加载 BPE rank 数据（Electron 离线可用）
 * 2. 失败则回退到 CDN (tiktoken.pages.dev)
 * 3. 加载期间使用启发式估算作为 fallback
 */

// ===== 类型定义 =====

interface TiktokenBPE {
  pat_str: string;
  special_tokens: Record<string, number>;
  bpe_ranks: string;
}

interface TiktokenInstance {
  encode(text: string, allowedSpecial?: Array<string> | 'all', disallowedSpecial?: Array<string> | 'all'): number[];
  decode(tokens: number[]): string;
}

// ===== 启发式估算 fallback（tiktoken 未就绪时使用） =====

function estimateTokensFallback(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x4E00 && code < 0x9FFF) {
      count += 0.67; // CJK
    } else if (code > 0x7F) {
      count += 0.5;  // 其他非 ASCII
    } else {
      count += 0.25; // ASCII
    }
  }
  return Math.ceil(count);
}

// ===== LRU 缓存 =====

class TokenCountCache {
  private cache = new Map<string, number>();
  private readonly maxSize: number;

  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
  }

  get(key: string): number | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // LRU: 移到末尾
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最旧的
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

// ===== 主服务 =====

@Injectable({
  providedIn: 'root'
})
export class TiktokenService {

  /** BPE rank 数据本地路径（public/ 目录映射到应用根路径） */
  private static readonly LOCAL_RANK_PATH = 'tiktoken/o200k_base.json';

  /** BPE rank 数据 CDN 地址 */
  private static readonly CDN_RANK_URL = 'https://tiktoken.pages.dev/js/o200k_base.json';

  /** 编码名称 */
  private static readonly ENCODING_NAME = 'o200k_base';

  /** 长文本分段阈值（超过此长度时分段编码，避免阻塞主线程） */
  private static readonly CHUNK_THRESHOLD = 50000;

  /** 分段大小 */
  private static readonly CHUNK_SIZE = 20000;

  /** 缓存 key 截断长度（避免超长文本作为 key） */
  private static readonly CACHE_KEY_MAX_LENGTH = 500;

  /** tiktoken 实例（懒加载） */
  private encoder: TiktokenInstance | null = null;

  /** 加载状态 */
  private loadingPromise: Promise<void> | null = null;
  private loadFailed = false;

  /** token 计数缓存（参考 Copilot BPETokenizer 的 5000 项 LRU 缓存） */
  private cache = new TokenCountCache(2000);

  /** 统计信息 */
  private stats = {
    exactCount: 0,
    fallbackCount: 0,
    cacheHits: 0,
  };

  constructor() {
    // 立即触发后台加载
    this.ensureLoaded();
  }

  // ==================== 公共接口 ====================

  /**
   * 计算文本的 token 数
   *
   * - tiktoken 已加载时返回精确值
   * - 未加载时使用启发式估算（误差约 ±15%）
   * - 短文本走 LRU 缓存
   */
  countTokens(text: string): number {
    if (!text) return 0;

    // 缓存查找（仅对短文本缓存，长文本直接计算）
    if (text.length <= TiktokenService.CACHE_KEY_MAX_LENGTH) {
      const cached = this.cache.get(text);
      if (cached !== undefined) {
        this.stats.cacheHits++;
        return cached;
      }
    }

    let count: number;
    if (this.encoder) {
      count = this.encodeCount(text);
      this.stats.exactCount++;
    } else {
      count = estimateTokensFallback(text);
      this.stats.fallbackCount++;
    }

    // 缓存结果
    if (text.length <= TiktokenService.CACHE_KEY_MAX_LENGTH) {
      this.cache.set(text, count);
    }

    return count;
  }

  /**
   * 编码文本为 token 数组
   * 仅在 tiktoken 已加载时有效，否则返回空数组
   */
  encode(text: string): number[] {
    if (!text || !this.encoder) return [];
    return this.encoder.encode(text);
  }

  /**
   * 解码 token 数组为文本
   */
  decode(tokens: number[]): string {
    if (!tokens || !this.encoder) return '';
    return this.encoder.decode(tokens);
  }

  /**
   * tiktoken 是否已就绪（精确模式）
   */
  get isReady(): boolean {
    return this.encoder !== null;
  }

  /**
   * 是否正在加载
   */
  get isLoading(): boolean {
    return this.loadingPromise !== null && !this.encoder && !this.loadFailed;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 等待 tiktoken 加载完成
   * 可用于需要精确 token 计数的场景
   */
  async waitForReady(): Promise<boolean> {
    await this.ensureLoaded();
    return this.encoder !== null;
  }

  // ==================== 内部方法 ====================

  /**
   * 使用 tiktoken 编码并计算 token 数
   * 长文本分段编码，避免阻塞
   */
  private encodeCount(text: string): number {
    if (!this.encoder) return estimateTokensFallback(text);

    // 短文本直接编码
    if (text.length <= TiktokenService.CHUNK_THRESHOLD) {
      return this.encoder.encode(text).length;
    }

    // 长文本分段编码
    let total = 0;
    for (let i = 0; i < text.length; i += TiktokenService.CHUNK_SIZE) {
      const chunk = text.substring(i, i + TiktokenService.CHUNK_SIZE);
      total += this.encoder.encode(chunk).length;
    }
    return total;
  }

  /**
   * 确保 tiktoken 编码器已加载（幂等）
   */
  private ensureLoaded(): Promise<void> {
    if (this.encoder) return Promise.resolve();
    if (this.loadFailed) return Promise.resolve();
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this.loadEncoder();
    return this.loadingPromise;
  }

  /**
   * 加载 tiktoken 编码器
   * 混合模式：本地 assets 优先，CDN 回退
   */
  private async loadEncoder(): Promise<void> {
    try {
      // 动态 import js-tiktoken/lite（tree-shaking 友好）
      const { Tiktoken } = await import('js-tiktoken/lite');

      let rankData: TiktokenBPE | null = null;

      // 1. 尝试从本地 assets 加载
      try {
        rankData = await this.fetchRankData(TiktokenService.LOCAL_RANK_PATH);
        console.log('[TikToken] BPE rank 数据已从本地加载');
      } catch {
        console.log('[TikToken] 本地加载失败，回退到 CDN...');
      }

      // 2. 回退到 CDN
      if (!rankData) {
        try {
          rankData = await this.fetchRankData(TiktokenService.CDN_RANK_URL);
          console.log('[TikToken] BPE rank 数据已从 CDN 加载');
        } catch (err) {
          console.warn('[TikToken] CDN 加载也失败:', err);
        }
      }

      if (!rankData) {
        console.warn('[TikToken] 无法加载 BPE rank 数据，将持续使用启发式估算');
        this.loadFailed = true;
        return;
      }

      // 3. 创建编码器实例
      this.encoder = new Tiktoken(rankData);
      this.loadFailed = false;

      console.log(`[TikToken] ${TiktokenService.ENCODING_NAME} 编码器已就绪（精确模式）`);
    } catch (err) {
      console.warn('[TikToken] 编码器加载失败:', err);
      this.loadFailed = true;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * 获取 BPE rank 数据
   */
  private async fetchRankData(url: string): Promise<TiktokenBPE> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}
