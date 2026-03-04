import { Component, Inject, OnDestroy, Optional, OnInit, NgZone } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NZ_MODAL_DATA } from 'ng-zorro-antd/modal';
import { ActivatedRoute } from '@angular/router';
import { ElectronService } from '../../services/electron.service';
import { ConnectionGraphService } from '../../services/connection-graph.service';
import { NoticeService } from '../../services/notice.service';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { NotificationComponent } from '../../components/notification/notification.component';
import { CommonModule } from '@angular/common';
import { WindowMessenger, connect, Connection } from 'penpal';
import { ProgressEvent } from '../../services/background-agent.service';

export interface IframeModalData {
  /** 要加载的 iframe URL */
  url: string;
  /** 传递给 iframe 页面的数据 */
  data?: unknown;
  /** 窗口标题 */
  title?: string;
}

@Component({
  selector: 'app-iframe',
  imports: [SubWindowComponent, NotificationComponent, CommonModule],
  templateUrl: './iframe.component.html',
  styleUrl: './iframe.component.scss'
})
export class IframeComponent implements OnInit, OnDestroy {
  iframeSrc: SafeResourceUrl = '';
  private iframeData: unknown;
  private allowedOrigins: string[] = ['*'];

  // Penpal 连接
  private penpalConnection: Connection | null = null;
  private remoteApi: any = null;

  // IPC 初始化数据清理函数
  private initDataCleanup: (() => void) | null = null;

  // IPC 监听器清理函数
  private ipcCleanup: (() => void) | null = null;

  // 窗口标题
  windowTitle = '';

  // 无数据状态显示控制
  showEmptyState = false;
  // Loading 状态显示控制
  isLoading = true;
  // 文件更新提示
  hasUpdate = false;

  // ===== 连线图自动生成相关 =====
  /** 是否为连线图窗口 */
  isConnectionGraphWindow = false;
  /** 是否正在生成中 */
  isGenerating = false;
  /** 进度 IPC 监听清理函数 */
  private progressIpcCleanup: (() => void) | null = null;
  /** getPayload 请求 IPC 监听清理函数 */
  private getPayloadIpcCleanup: (() => void) | null = null;
  /** schematic-start-generating IPC 监听清理函数 */
  private schematicStartGeneratingIpcCleanup: (() => void) | null = null;

  constructor(
    @Optional() @Inject(NZ_MODAL_DATA) public data: IframeModalData | null,
    private sanitizer: DomSanitizer,
    private route: ActivatedRoute,
    private electronService: ElectronService,
    private connectionGraphService: ConnectionGraphService,
    private noticeService: NoticeService,
    private ngZone: NgZone,
  ) {
    // 如果是从 modal 打开，使用 modal data
    if (this.data) {
      if (this.data.url) {
        this.iframeSrc = this.sanitizer.bypassSecurityTrustResourceUrl(this.data.url);
        try {
          this.allowedOrigins = [new URL(this.data.url).origin];
        } catch {
          this.allowedOrigins = ['*'];
        }
      }
      if (this.data.data) {
        this.iframeData = this.data.data;
      }
      if (this.data.title) {
        this.windowTitle = this.data.title;
      }
    }
  }

  async ngOnInit() {
    // 延迟显示无数据状态（如果加载失败）
    setTimeout(() => {
      if (this.isLoading) {
        this.isLoading = false;
        this.showEmptyState = true;
      }
    }, 10000); // 10秒超时

    await new Promise(resolve => setTimeout(resolve, 100));

    // 如果不是 modal 模式，从 URL 查询参数读取
    if (!this.data) {
      this.route.queryParams.subscribe(params => {
        const url = params['url'];
        if (url) {
          this.iframeSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
          try {
            this.allowedOrigins = [new URL(url).origin];
          } catch {
            this.allowedOrigins = ['*'];
          }

          // 检测是否为连线图窗口
          if (url.includes('connection-graph')) {
            this.isConnectionGraphWindow = true;
            // 监听主窗口获取 payload 的 IPC 请求
            if (this.electronService.isElectron && window['ipcRenderer']) {
              this.startGetPayloadIpcListener();
              this.startSchematicStartGeneratingListener();
            }
          }
        }

        // 检测生成模式
        const mode = params['mode'];
        if (mode === 'generating') {
          this.isGenerating = true;
          this.noticeService.update({title: 'AI生成中', text: '正在准备生成连线图...', state: 'doing', showProgress: false });
          this.startProgressIpcListener();
        }

        const filePath = params['filePath'];
        if (filePath && this.electronService.isElectron) {
          try {
            if (this.electronService.exists(filePath)) {
              const content = this.electronService.readFile(filePath);
              this.iframeData = JSON.parse(content);
            } else {
              console.error('文件不存在:', filePath);
            }
          } catch (error) {
            console.error('读取文件失败:', error);
          }
        }
      });

      // 监听来自 openWindow 的 IPC 初始化数据
      if (this.electronService.isElectron && window['subWindow']?.onInitData) {
        this.initDataCleanup = window['subWindow'].onInitData((initData: any) => {
          this.handleInitData(initData);
        });
      }

    }
  }

  /**
   * 处理来自 openWindow 传递的 IPC 初始化数据
   */
  private handleInitData(initData: any): void {
    console.log('[IframeComponent] handleInitData received:', initData ? 'has data' : 'null');
    if (!initData) return;

    if (initData.title) {
      this.windowTitle = initData.title;
    }

    if (initData.url) {
      this.iframeSrc = this.sanitizer.bypassSecurityTrustResourceUrl(initData.url);
      try {
        this.allowedOrigins = [new URL(initData.url).origin];
      } catch {
        this.allowedOrigins = ['*'];
      }
    }

    this.iframeData = initData.data !== undefined ? initData.data : initData;
    console.log('[IframeComponent] iframeData set:', this.iframeData ? JSON.stringify(this.iframeData).slice(0, 300) + '...' : 'null');



    // 如果 penpal 连接已建立且有数据，立即推送给子页面
    this.pushDataToRemote();
  }

  /**
   * iframe 加载完成后，使用 penpal 建立连接
   */
  onIframeLoad(event: Event): void {
    const iframe = event.target as HTMLIFrameElement;
    if (!iframe.contentWindow) {
      this.handleLoadError();
      return;
    }

    // 销毁旧连接，避免连接残留
    if (this.penpalConnection) {
      this.penpalConnection.destroy();
      this.penpalConnection = null;
      this.remoteApi = null;
    }

    this.setupPenpalConnection(iframe);
  }

  /**
   * 使用 penpal 建立与 iframe 的双向通信
   */
  private async setupPenpalConnection(iframe: HTMLIFrameElement): Promise<void> {
    try {
      const messenger = new WindowMessenger({
        remoteWindow: iframe.contentWindow!,
        allowedOrigins: this.allowedOrigins,
      });

      // 父窗口暴露给子页面的方法
      this.penpalConnection = connect({
        messenger,
        methods: {
          // 子页面调用此方法获取数据
          getData: () => {
            return this.iframeData ?? null;
          },
          // 子页面编辑连线后回调此方法，持久化更新
          onConnectionsChanged: (connections: any) => {
            try {
              if (connections && Array.isArray(connections)) {
                // 获取当前 payload 数据（包含 componentConfigs, components, connections）
                const currentPayload = this.iframeData as any;
                if (currentPayload && currentPayload.components) {
                  // 通过 IPC 让主窗口保存数据（子窗口无法直接访问 projectPath）
                  if (this.electronService.isElectron && window['ipcRenderer']) {
                    const updatedData = {
                      version: '1.0.0',
                      description: '',
                      components: currentPayload.components,
                      connections: connections,
                    };
                    window['ipcRenderer'].send('save-connection-graph', updatedData);
                    // 同步本地 iframeData（payload 格式）
                    this.iframeData = {
                      ...currentPayload,
                      connections: connections,
                    };
                    console.log('[IframeComponent] 已发送保存请求:', connections.length);
                  }
                }
              }
            } catch (e) {
              console.warn('onConnectionsChanged 持久化失败:', e);
            }
          },
        },
      });

      const remote = await this.penpalConnection.promise;
      this.remoteApi = remote;

      // 将 remote API 注册到 ConnectionGraphService，供 Agent 工具推送数据
      this.connectionGraphService.setIframeApi(remote);

      // 连接成功，结束 loading
      this.isLoading = false;
      this.showEmptyState = false;

      // 如果有数据，主动推送给子页面
      this.pushDataToRemote();

      // 开始监听 IPC 通知
      this.startIpcListener();
    } catch (error) {
      console.error('Penpal 连接失败:', error);
      // 连接失败时降级：使用 postMessage 发送数据
      this.isLoading = false;
      this.showEmptyState = false;
    }
  }

  /**
   * 推送数据给已连接的子页面（penpal 方式）
   */
  private async pushDataToRemote(): Promise<void> {
    console.log('[IframeComponent] pushDataToRemote called, hasRemoteApi:', !!this.remoteApi, 'hasData:', !!this.iframeData);
    if (!this.remoteApi || !this.iframeData) return;
    try {
      if (typeof this.remoteApi['receiveData'] === 'function') {
        console.log('[IframeComponent] calling remoteApi.receiveData...');
        await (this.remoteApi['receiveData'] as (data: unknown) => Promise<void>)(this.iframeData);
        console.log('[IframeComponent] receiveData completed');
      }
    } catch (error) {
      console.warn('推送数据给子页面失败:', error);
    }
  }

  /**
   * 处理加载错误
   */
  handleLoadError(): void {
    this.isLoading = false;
    this.showEmptyState = true;
  }

  /**
   * 调用子页面暴露的远程方法
   */
  async callRemote(method: string, ...args: any[]): Promise<any> {
    if (!this.remoteApi || typeof this.remoteApi[method] !== 'function') {
      console.warn(`远程方法 ${method} 不可用`);
      return null;
    }
    return this.remoteApi[method](...args);
  }

  /**
   * 开始监听 getPayload 请求 IPC
   */
  private startGetPayloadIpcListener(): void {
    if (!this.electronService.isElectron || !window['ipcRenderer']) return;

    const handler = (_event: any, messageId: string) => {
      const payload = this.getPayload();
      window['ipcRenderer'].send('get-connection-graph-payload-response', { messageId, payload });
    };

    window['ipcRenderer'].on('get-connection-graph-payload-request', handler);

    this.getPayloadIpcCleanup = () => {
      window['ipcRenderer'].removeListener('get-connection-graph-payload-request', handler);
    };
  }

  /**
   * 监听主窗口通知切换到生成模式
   */
  private startSchematicStartGeneratingListener(): void {
    if (!this.electronService.isElectron || !window['ipcRenderer']) return;

    const handler = () => {
      this.ngZone.run(() => {
        this.isGenerating = true;
        this.noticeService.update({ title: 'AI生成中', text: '正在准备生成连线图...', state: 'doing', showProgress: false });
        this.startProgressIpcListener();
      });
    };

    window['ipcRenderer'].on('schematic-start-generating', handler);

    this.schematicStartGeneratingIpcCleanup = () => {
      window['ipcRenderer'].removeListener('schematic-start-generating', handler);
    };
  }

  ngOnDestroy(): void {
    if (this.getPayloadIpcCleanup) {
      this.getPayloadIpcCleanup();
      this.getPayloadIpcCleanup = null;
    }
    if (this.schematicStartGeneratingIpcCleanup) {
      this.schematicStartGeneratingIpcCleanup();
      this.schematicStartGeneratingIpcCleanup = null;
    }
    // 清除 ConnectionGraphService 中的 iframe API 引用
    this.connectionGraphService.clearIframeApi();
    if (this.penpalConnection) {
      this.penpalConnection.destroy();
      this.penpalConnection = null;
    }
    if (this.initDataCleanup) {
      this.initDataCleanup();
      this.initDataCleanup = null;
    }
    // 停止 IPC 监听
    this.stopIpcListener();
    this.stopProgressIpcListener();
  }

  // =====================================================
  // IPC 监听相关
  // =====================================================

  /**
   * 开始监听连线图更新 IPC 通知
   */
  private startIpcListener(): void {
    if (!this.electronService.isElectron || !window['ipcRenderer']) return;

    console.log('[IframeComponent] 开始监听 IPC connection-graph-updated');

    const handler = (_event: any, data: any) => {
      console.log('[IframeComponent] 收到 IPC connection-graph-updated');
      this.ngZone.run(() => {
        this.handleConnectionGraphUpdate(data);
      });
    };

    window['ipcRenderer'].on('connection-graph-updated', handler);

    // 保存清理函数
    this.ipcCleanup = () => {
      window['ipcRenderer'].removeListener('connection-graph-updated', handler);
    };
  }

  /**
   * 停止 IPC 监听
   */
  private stopIpcListener(): void {
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }
  }

  /**
   * 处理连线图更新通知
   */
  private async handleConnectionGraphUpdate(data: any): Promise<void> {
    if (!data) return;

    try {
      // 使用 IPC 发送过来的完整 payload（包含最新的 componentConfigs）
      const currentPayload = this.iframeData as any;
      const newPayload = {
        // 优先使用新的 componentConfigs，如果没有则保留旧的
        componentConfigs: data.componentConfigs || currentPayload?.componentConfigs || {},
        components: data.components || [],
        connections: data.connections || [],
        theme: data.theme || currentPayload?.theme || 'dark',
      };
      this.iframeData = newPayload;
      // 推送给 iframe
      await this.pushDataToRemote();
      console.log('[IframeComponent] 连线图已自动更新');
      
      this.noticeService.update({title: 'AI生成中', text: '连线图已自动更新', state: 'done', setTimeout: 3000 });
    } catch (error) {
      console.error('[IframeComponent] 处理连线图更新失败:', error);
    }
  }

  /**
   * 关闭更新提示（用户选择不刷新）
   */
  dismissUpdate(): void {
    this.hasUpdate = false;
  }

  // =====================================================
  // 连线图自动生成 - 进度监听 & 操作按钮
  // =====================================================

  /**
   * 开始监听生成进度 IPC
   */
  private startProgressIpcListener(): void {
    if (!this.electronService.isElectron || !window['ipcRenderer']) return;

    console.log('[IframeComponent] 开始监听 schematic-generation-progress');

    const handler = (_event: any, data: ProgressEvent) => {
      this.ngZone.run(() => {
        this.handleProgressEvent(data);
      });
    };

    window['ipcRenderer'].on('schematic-generation-progress', handler);

    this.progressIpcCleanup = () => {
      window['ipcRenderer'].removeListener('schematic-generation-progress', handler);
    };
  }

  /**
   * 停止生成进度 IPC 监听
   */
  private stopProgressIpcListener(): void {
    if (this.progressIpcCleanup) {
      this.progressIpcCleanup();
      this.progressIpcCleanup = null;
    }
  }

  /**
   * 处理进度事件 → 更新 notice 通知栏
   */
  private handleProgressEvent(event: ProgressEvent): void {
    if (!event) return;

    switch (event.type) {
      case 'thinking':
        this.noticeService.update({title: 'AI生成中', text: event.content || '正在分析项目...', state: 'doing', showProgress: false });
        break;
      case 'tool_call':
        this.noticeService.update({title: 'AI生成中', text: event.content || '正在执行工具...', state: 'doing', showProgress: false });
        break;
      case 'tool_result':
        this.noticeService.update({title: 'AI生成中', text: event.content || '工具执行完成', state: 'doing', showProgress: false });
        break;
      case 'complete':
        this.isGenerating = false;
        this.noticeService.update({title: 'AI生成完成', text: '连线图生成完成', state: 'done', setTimeout: 3000 });
        break;
      case 'error':
        this.isGenerating = false;
        this.noticeService.update({title: 'AI生成失败', text: event.content || '生成失败', state: 'error', setTimeout: 5000 });
        break;
      default:
        if (event.content) {
          this.noticeService.update({title: 'AI生成中', text: event.content, state: 'doing', showProgress: false });
        }
    }
  }

  /**
   * 操作按钮: 重新生成
   */
  onRegenerate(): void {
    this.isGenerating = true;
    this.noticeService.update({title: 'AI生成中', text: '正在重新生成连线图...', state: 'doing', showProgress: false });

    // 开始监听进度（如果之前已停止）
    if (!this.progressIpcCleanup) {
      this.startProgressIpcListener();
    }

    // 调用 iframe 通讯方法清理缓存
    this.callRemote('clearCache').catch(() => {
      // 子页面未暴露 clearCache 时静默忽略
    });

    // 发送 IPC 到主窗口触发 BackgroundAgentService 重新生成
    if (this.electronService.isElectron && window['ipcRenderer']) {
      window['ipcRenderer'].send('schematic-regenerate-request');
    }
  }

  /**
   * 操作按钮: 同步到代码
   */
  onSyncToCode(): void {
    if (this.electronService.isElectron && window['ipcRenderer']) {
      window['ipcRenderer'].send('schematic-sync-to-code-request');
    }
  }

  /**
   * 获取当前 payload（供主窗口 IPC 调用）
   */
  getPayload(): unknown {
    return this.iframeData ?? null;
  }
}
