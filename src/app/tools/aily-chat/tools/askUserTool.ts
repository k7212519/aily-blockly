/**
 * ask_user 工具 — 向用户提问并等待回答
 *
 * 参考 VS Code Copilot 的 ask_user / vscode_askQuestions 工具设计。
 * 支持两种交互模式：
 *   1. 选择题模式：提供可选项列表，用户点选
 *   2. 自由输入模式：用户自由输入文本
 *
 * 工具执行时会暂停 LLM 对话，等待用户在聊天界面中回答后再继续。
 */

import { ToolUseResult } from './tools';

// ============================
// 类型定义
// ============================

export interface AskUserArgs {
  /** 向用户提出的问题 */
  question: string;
  /** 可选的选择项（不提供则为自由输入模式） */
  choices?: string[];
  /** 是否允许自由输入（当有 choices 时，默认 false；无 choices 时固定 true） */
  allow_freeform?: boolean;
}

export interface AskUserResponse {
  /** 用户的回答内容 */
  answer: string;
  /** 是否为自由输入（而非选中选项） */
  wasFreeform: boolean;
}

// ============================
// 全局回调注册
// ============================

type AskUserCallback = (question: string, choices?: string[], allowFreeform?: boolean) => Promise<AskUserResponse | undefined>;

let _registeredCallback: AskUserCallback | null = null;

/**
 * 注册用户交互回调。由 UI 层（aily-chat 组件或 ChatEngineService）初始化时调用。
 * 回调负责在聊天界面显示问题和选项，等待用户选择后返回结果。
 */
export function registerAskUserCallback(cb: AskUserCallback): void {
  _registeredCallback = cb;
}

/**
 * 取消注册回调（组件销毁时调用）
 */
export function unregisterAskUserCallback(): void {
  _registeredCallback = null;
}

// ============================
// 工具执行函数
// ============================

export async function askUserTool(args: AskUserArgs): Promise<ToolUseResult> {
  const { question, choices, allow_freeform } = args;

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return {
      is_error: true,
      content: '参数错误：question 不能为空',
    };
  }

  // 确定是否允许自由输入
  const allowFreeform = choices && choices.length > 0 ? (allow_freeform ?? false) : true;

  try {
    let response: AskUserResponse | undefined;

    if (_registeredCallback) {
      // UI 层已注册回调，通过聊天界面交互
      response = await _registeredCallback(question.trim(), choices, allowFreeform);
    } else {
      // 降级：使用 window.prompt（仅 GUI 环境）
      response = await fallbackPrompt(question.trim(), choices, allowFreeform);
    }

    if (!response || !response.answer) {
      return {
        is_error: false,
        content: '用户未提供回答（跳过或取消）。',
        metadata: { skipped: true },
      };
    }

    return {
      is_error: false,
      content: response.answer,
      metadata: {
        wasFreeform: response.wasFreeform,
        originalQuestion: question.trim(),
      },
    };
  } catch (error: any) {
    return {
      is_error: true,
      content: `向用户提问时出错: ${error.message || '未知错误'}`,
    };
  }
}

// ============================
// 降级实现
// ============================

async function fallbackPrompt(
  question: string,
  choices?: string[],
  allowFreeform?: boolean,
): Promise<AskUserResponse | undefined> {
  if (typeof window === 'undefined') {
    return undefined;
  }

  if (choices && choices.length > 0 && !allowFreeform) {
    // 选择题模式：构建带编号的选择提示
    const choiceText = choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const promptText = `${question}\n\n${choiceText}\n\n请输入选项编号 (1-${choices.length}):`;
    const input = window.prompt(promptText);

    if (input === null) return undefined;

    const idx = parseInt(input.trim(), 10);
    if (idx >= 1 && idx <= choices.length) {
      return { answer: choices[idx - 1], wasFreeform: false };
    }
    // 无效输入，返回原始输入
    return { answer: input.trim(), wasFreeform: true };
  }

  // 自由输入模式
  let promptText = question;
  if (choices && choices.length > 0) {
    const choiceText = choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
    promptText = `${question}\n\n可选：\n${choiceText}\n\n也可以直接输入:`;
  }

  const input = window.prompt(promptText);
  if (input === null) return undefined;

  // 检测是否选择了预设选项
  if (choices && choices.length > 0) {
    const idx = parseInt(input.trim(), 10);
    if (idx >= 1 && idx <= choices.length) {
      return { answer: choices[idx - 1], wasFreeform: false };
    }
    const exactMatch = choices.find(c => c.toLowerCase() === input.trim().toLowerCase());
    if (exactMatch) {
      return { answer: exactMatch, wasFreeform: false };
    }
  }

  return { answer: input.trim(), wasFreeform: true };
}
