/**
 * Blockly ABS 解析器 (Aily Block Syntax)
 * 
 * 将缩进格式的伪代码转换为 Blockly JSON 结构
 * 设计目标：减少 LLM 生成代码时的出错率，提高可读性
 * 
 * @example
 * ```
 * # 变量定义
 * @var count: int = 0
 * 
 * # Arduino 主程序
 * arduino_setup
 *     serial_begin(Serial, 115200)
 *     oled_begin()
 * 
 * arduino_loop
 *     serial_print(Serial, "Count: ")
 *     serial_println(Serial, $count)
 *     math_change($count, 1)
 *     delay(1000)
 * ```
 */

import { BlockConfig } from './editBlockTool';
import { 
  BlockMeta as DynamicBlockMeta,
  getGlobalBlockMetas, 
  setGlobalBlockMetas, 
  loadBlockDefinitionsFromPath 
} from '../services/block-definition.service';

// =============================================================================
// 类型定义
// =============================================================================

/**
 * 解析后的变量定义
 */
interface VariableDefinition {
  name: string;
  type: string;
  initialValue?: string;
}

/**
 * 解析后的 ABS 节点
 */
interface AbsNode {
  type: string;                    // 块类型
  fields: Record<string, any>;     // 字段值
  inputs: Record<string, AbsNode | AbsNode[]>;  // 输入（值输入或语句输入）
  children: AbsNode[];             // next 连接的子节点
  indent: number;                  // 缩进级别
  lineNumber: number;              // 源代码行号
  raw: string;                     // 原始行内容
}

/**
 * ABS 解析结果
 */
export interface AbsParseResult {
  success: boolean;
  variables: VariableDefinition[];
  rootBlocks: BlockConfig[];
  errors: Array<{
    line: number;
    message: string;
    suggestion?: string;
  }>;
  warnings: Array<{
    line: number;
    message: string;
  }>;
}

/**
 * 块定义元信息（用于智能解析）- 本地接口用于兼容
 */
interface BlockMeta {
  type: string;
  hasStatementInput?: boolean;        // 是否有语句输入
  statementInputNames?: string[];     // 语句输入名称列表
  valueInputNames?: string[];         // 值输入名称列表
  fieldNames?: string[];              // 字段名称列表
  isRootBlock?: boolean;              // 是否为根块
  isValueBlock?: boolean;             // 是否为无参数值块（如 esp32_wifi_status）
}

// =============================================================================
// 动态块定义管理
// =============================================================================

/**
 * 从项目动态加载块定义
 * @param projectPath 项目路径
 */
export function loadProjectBlockDefinitions(projectPath: string): void {
  try {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      console.warn('[absParser] electronAPI 不可用，使用内置块定义');
      return;
    }
    
    const metas = loadBlockDefinitionsFromPath(projectPath, electronAPI);
    setGlobalBlockMetas(metas);
    console.log(`[absParser] 已从项目加载 ${metas.size} 个块定义`);
  } catch (e) {
    console.warn('[absParser] 加载项目块定义失败:', e);
  }
}

/**
 * 获取块的元信息（优先从动态加载的定义获取）
 */
function getBlockMeta(blockType: string): Partial<BlockMeta> | undefined {
  // 优先从动态加载的块定义获取
  const dynamicMetas = getGlobalBlockMetas();
  if (dynamicMetas) {
    const dynamicMeta = dynamicMetas.get(blockType);
    if (dynamicMeta) {
      return convertDynamicMeta(dynamicMeta);
    }
  }
  
  // 回退到内置定义
  return FALLBACK_BLOCKS[blockType];
}

/**
 * 检查块类型是否已知
 */
function isKnownBlock(blockType: string): boolean {
  const dynamicMetas = getGlobalBlockMetas();
  if (dynamicMetas?.has(blockType)) {
    return true;
  }
  return blockType in FALLBACK_BLOCKS;
}

/**
 * 将动态块元信息转换为本地格式
 */
function convertDynamicMeta(meta: DynamicBlockMeta): Partial<BlockMeta> {
  return {
    fieldNames: meta.fieldNames.length > 0 ? meta.fieldNames : undefined,
    valueInputNames: meta.valueInputNames.length > 0 ? meta.valueInputNames : undefined,
    statementInputNames: meta.statementInputNames.length > 0 ? meta.statementInputNames : undefined,
    hasStatementInput: meta.statementInputNames.length > 0,
    isRootBlock: meta.isRootBlock,
    isValueBlock: meta.hasOutput && meta.fieldNames.length === 0 && meta.valueInputNames.length === 0,
  };
}

// =============================================================================
// 内置块定义（作为动态加载失败时的回退）
// =============================================================================

/**
 * 内置块定义 - 仅包含核心块，作为动态加载失败时的回退
 */
const FALLBACK_BLOCKS: Record<string, Partial<BlockMeta>> = {
  // Arduino 核心块
  'arduino_setup': { 
    isRootBlock: true, 
    hasStatementInput: true, 
    statementInputNames: ['ARDUINO_SETUP'] 
  },
  'arduino_loop': { 
    isRootBlock: true, 
    hasStatementInput: true, 
    statementInputNames: ['ARDUINO_LOOP'] 
  },
  
  // 串口通信
  'serial_begin': { fieldNames: ['SERIAL', 'SPEED'] },
  'serial_print': { fieldNames: ['SERIAL'], valueInputNames: ['VAR'] },
  'serial_println': { fieldNames: ['SERIAL'], valueInputNames: ['VAR'] },
  
  // 时间
  'time_delay': { valueInputNames: ['DELAY_TIME'] },
  'time_millis': { isValueBlock: true },
  
  // 变量定义
  'variable_define': { fieldNames: ['VAR', 'TYPE'], valueInputNames: ['VALUE'] },
  
  // 控制流（Blockly 内置）
  'controls_if': { 
    hasStatementInput: true, 
    statementInputNames: ['DO0', 'ELSE'],
    valueInputNames: ['IF0']
  },
  'controls_repeat_ext': { 
    hasStatementInput: true, 
    statementInputNames: ['DO'],
    valueInputNames: ['TIMES']
  },
  'controls_whileUntil': { 
    hasStatementInput: true, 
    statementInputNames: ['DO'],
    valueInputNames: ['BOOL'],
    fieldNames: ['MODE']
  },
  'controls_for': { 
    hasStatementInput: true, 
    statementInputNames: ['DO'],
    valueInputNames: ['FROM', 'TO', 'BY'],
    fieldNames: ['VAR']
  },
  
  // 基础块（Blockly 内置）
  'math_number': { fieldNames: ['NUM'] },
  'math_arithmetic': { fieldNames: ['OP'], valueInputNames: ['A', 'B'] },
  'math_change': { fieldNames: ['VAR'], valueInputNames: ['DELTA'] },
  'text': { fieldNames: ['TEXT'] },
  'text_join': { valueInputNames: ['ADD0', 'ADD1'] },
  'logic_compare': { fieldNames: ['OP'], valueInputNames: ['A', 'B'] },
  'logic_operation': { fieldNames: ['OP'], valueInputNames: ['A', 'B'] },
  'logic_boolean': { fieldNames: ['BOOL'] },
  'logic_negate': { valueInputNames: ['BOOL'] },
  'variables_get': { fieldNames: ['VAR'] },
  'variables_set': { fieldNames: ['VAR'], valueInputNames: ['VALUE'] },
  
  // DHT 传感器（常用）
  'dht_init': { fieldNames: ['VAR', 'TYPE'] },  // PIN 是动态添加的
  'dht_read_temperature': { fieldNames: ['VAR'] },
  'dht_read_humidity': { fieldNames: ['VAR'] },
  'dht_read_success': { fieldNames: ['VAR'] },
};

/**
 * 去掉字符串两端的引号
 */
function stripQuotes(str: string): string {
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * 特殊语法糖映射
 */
const SYNTAX_SUGAR: Record<string, (args: string[]) => { type: string; fields?: Record<string, any>; inputs?: Record<string, any> }> = {
  // $varName -> variables_get
  'var': (args) => ({
    type: 'variables_get',
    fields: { VAR: { name: args[0] } }
  }),
  
  // text("...") -> text block（去掉参数中的引号）
  'text': (args) => ({
    type: 'text',
    fields: { TEXT: stripQuotes(args[0] || '') }
  }),
  
  // number(123) -> math_number
  'number': (args) => ({
    type: 'math_number',
    fields: { NUM: args[0] || '0' }
  }),
  
  // HIGH/LOW -> logic_boolean 或数字
  'HIGH': () => ({
    type: 'math_number',
    fields: { NUM: '1' }
  }),
  'LOW': () => ({
    type: 'math_number',
    fields: { NUM: '0' }
  }),
  
  // true/false -> logic_boolean
  'true': () => ({
    type: 'logic_boolean',
    fields: { BOOL: 'TRUE' }
  }),
  'false': () => ({
    type: 'logic_boolean',
    fields: { BOOL: 'FALSE' }
  }),
};

// =============================================================================
// 主解析器类
// =============================================================================

export class BlocklyAbsParser {
  private lines: string[] = [];
  private currentLine = 0;
  private variables: VariableDefinition[] = [];
  private errors: AbsParseResult['errors'] = [];
  private warnings: AbsParseResult['warnings'] = [];
  private indentSize = 4;  // 默认缩进大小
  
  /**
   * 解析 ABS 代码
   * @param code ABS 源代码
   * @returns 解析结果
   */
  parse(code: string): AbsParseResult {
    this.reset();
    this.lines = code.split('\n');
    
    // 自动检测缩进大小
    this.detectIndentSize();
    
    const rootNodes: AbsNode[] = [];
    
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];
      const trimmed = line.trim();
      
      // 跳过空行和注释
      if (!trimmed || trimmed.startsWith('#')) {
        this.currentLine++;
        continue;
      }
      
      // 处理变量定义
      if (trimmed.startsWith('@var ')) {
        this.parseVariableDefinition(trimmed);
        this.currentLine++;
        continue;
      }
      
      // 处理命名输入标记（@condition:, @do: 等）
      if (trimmed.startsWith('@') && trimmed.includes(':')) {
        // 这应该在块内部处理，顶层出现是错误
        this.errors.push({
          line: this.currentLine + 1,
          message: `命名输入标记 "${trimmed}" 不能出现在顶层`,
          suggestion: '命名输入应该在块内部使用'
        });
        this.currentLine++;
        continue;
      }
      
      // 解析根块
      const node = this.parseBlock(0);
      if (node) {
        rootNodes.push(node);
      }
    }
    
    // 转换为 BlockConfig
    const rootBlocks = rootNodes.map(node => this.nodeToBlockConfig(node));
    
    return {
      success: this.errors.length === 0,
      variables: this.variables,
      rootBlocks,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  
  /**
   * 重置解析器状态
   */
  private reset(): void {
    this.lines = [];
    this.currentLine = 0;
    this.variables = [];
    this.errors = [];
    this.warnings = [];
  }
  
  /**
   * 自动检测缩进大小
   */
  private detectIndentSize(): void {
    for (const line of this.lines) {
      if (line.length > 0 && line[0] === ' ') {
        const spaces = line.match(/^( +)/);
        if (spaces) {
          this.indentSize = spaces[1].length;
          break;
        }
      }
      if (line[0] === '\t') {
        this.indentSize = 1;  // Tab 模式
        break;
      }
    }
  }
  
  /**
   * 获取行的缩进级别
   */
  private getIndentLevel(line: string): number {
    if (!line) return 0;
    const match = line.match(/^([ \t]*)/);
    if (!match) return 0;
    
    const indent = match[1];
    if (indent.includes('\t')) {
      return indent.length;  // Tab 模式
    }
    return Math.floor(indent.length / this.indentSize);
  }
  
  /**
   * 解析变量定义
   * 格式: @var name: type = value
   */
  private parseVariableDefinition(line: string): void {
    // @var count: int = 0
    // @var name: String = "hello"
    const match = line.match(/@var\s+(\w+)\s*:\s*(\w+)\s*(?:=\s*(.+))?/);
    
    if (!match) {
      this.errors.push({
        line: this.currentLine + 1,
        message: `无效的变量定义: ${line}`,
        suggestion: '格式应为: @var name: type = value'
      });
      return;
    }
    
    this.variables.push({
      name: match[1],
      type: match[2],
      initialValue: match[3]?.trim()
    });
  }
  
  /**
   * 解析块
   * @param expectedIndent 期望的缩进级别
   * @returns 解析后的节点
   */
  private parseBlock(expectedIndent: number): AbsNode | null {
    if (this.currentLine >= this.lines.length) {
      return null;
    }
    
    const line = this.lines[this.currentLine];
    const trimmed = line.trim();
    const actualIndent = this.getIndentLevel(line);
    
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) {
      this.currentLine++;
      return this.parseBlock(expectedIndent);
    }
    
    // 如果缩进小于期望，说明块结束
    if (actualIndent < expectedIndent) {
      return null;
    }
    
    // 解析当前行
    const { type, fields, inlineInputs } = this.parseBlockLine(trimmed);
    
    if (!type) {
      this.errors.push({
        line: this.currentLine + 1,
        message: `无法解析块: ${trimmed}`
      });
      this.currentLine++;
      return null;
    }
    
    const node: AbsNode = {
      type,
      fields,
      inputs: { ...inlineInputs },
      children: [],
      indent: actualIndent,
      lineNumber: this.currentLine + 1,
      raw: trimmed
    };
    
    this.currentLine++;
    
    // 解析子块（缩进更深的行）
    const childIndent = expectedIndent + 1;
    const blockMeta = getBlockMeta(type) || {};
    
    // 收集所有缩进更深的行作为子内容
    const childNodes: AbsNode[] = [];
    const namedInputs: Record<string, AbsNode[]> = {};
    let currentInputName: string | null = null;
    
    while (this.currentLine < this.lines.length) {
      const nextLine = this.lines[this.currentLine];
      const nextTrimmed = nextLine.trim();
      const nextIndent = this.getIndentLevel(nextLine);
      
      // 跳过空行和注释
      if (!nextTrimmed || nextTrimmed.startsWith('#')) {
        this.currentLine++;
        continue;
      }
      
      // 如果缩进回到同级或更少，结束子块解析
      if (nextIndent <= actualIndent) {
        break;
      }
      
      // 检查是否是命名输入标记
      if (nextTrimmed.startsWith('@') && nextTrimmed.includes(':')) {
        const inputMatch = nextTrimmed.match(/@(\w+):\s*(.*)?/);
        if (inputMatch) {
          currentInputName = this.normalizeInputName(inputMatch[1]);
          
          // 如果同一行有内容，解析为值输入
          if (inputMatch[2] && inputMatch[2].trim()) {
            const valueNode = this.parseInlineValue(inputMatch[2].trim());
            if (valueNode) {
              node.inputs[currentInputName] = valueNode;
            }
            currentInputName = null;  // 重置，因为已经处理了
          }
          
          this.currentLine++;
          continue;
        }
      }
      
      // 解析子块
      const childNode = this.parseBlock(childIndent);
      if (childNode) {
        if (currentInputName) {
          // 添加到命名输入
          if (!namedInputs[currentInputName]) {
            namedInputs[currentInputName] = [];
          }
          namedInputs[currentInputName].push(childNode);
        } else {
          childNodes.push(childNode);
        }
      }
    }
    
    // 处理子节点
    if (childNodes.length > 0) {
      if (blockMeta.hasStatementInput && blockMeta.statementInputNames) {
        // 如果块有语句输入，将子节点放入第一个语句输入
        const inputName = blockMeta.statementInputNames[0];
        node.inputs[inputName] = childNodes;
      } else {
        // 否则作为 next 连接
        node.children = childNodes;
      }
    }
    
    // 处理命名输入
    for (const [inputName, nodes] of Object.entries(namedInputs)) {
      if (nodes.length === 1) {
        node.inputs[inputName] = nodes[0];
      } else {
        node.inputs[inputName] = nodes;
      }
    }
    
    return node;
  }
  
  /**
   * 解析块行
   * 格式: block_type(arg1, arg2, ...) 或 block_type 或 block_type()
   */
  private parseBlockLine(line: string): {
    type: string;
    fields: Record<string, any>;
    inlineInputs: Record<string, AbsNode>;
  } {
    const fields: Record<string, any> = {};
    const inlineInputs: Record<string, AbsNode> = {};
    
    // 匹配 block_type(args) 或 block_type 或 block_type()（空括号）
    const match = line.match(/^(\w+)(?:\((.*)\))?$/);
    
    if (!match) {
      return { type: '', fields, inlineInputs };
    }
    
    const type = match[1];
    const argsString = match[2];
    
    if (argsString) {
      const args = this.parseArguments(argsString);
      this.assignArguments(type, args, fields, inlineInputs);
    }
    
    return { type, fields, inlineInputs };
  }
  
  /**
   * 解析参数列表
   * 支持嵌套括号和字符串
   */
  private parseArguments(argsString: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];
      
      // 处理字符串
      if ((char === '"' || char === "'") && (i === 0 || argsString[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        current += char;
        continue;
      }
      
      if (inString) {
        current += char;
        continue;
      }
      
      // 处理括号嵌套
      if (char === '(' || char === '[' || char === '{') {
        depth++;
        current += char;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      args.push(current.trim());
    }
    
    return args;
  }
  
  /**
   * 分配参数到字段和输入
   */
  private assignArguments(
    blockType: string,
    args: string[],
    fields: Record<string, any>,
    inlineInputs: Record<string, AbsNode>
  ): void {
    const meta = getBlockMeta(blockType);
    
    // 首先提取命名参数（KEY=value 格式）
    const namedArgs: Record<string, string> = {};
    const positionalArgs: string[] = [];
    
    for (const arg of args) {
      // 检查是否是命名参数（KEY=value，但要避免匹配函数调用中的 = ）
      const namedMatch = arg.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/i);
      if (namedMatch && !arg.includes('(')) {
        namedArgs[namedMatch[1].toUpperCase()] = namedMatch[2];
      } else {
        positionalArgs.push(arg);
      }
    }
    
    // 处理命名参数
    for (const [fieldName, value] of Object.entries(namedArgs)) {
      if (this.isComplexExpression(value)) {
        const valueNode = this.parseInlineValue(value);
        if (valueNode) {
          inlineInputs[fieldName] = valueNode;
        }
      } else {
        fields[fieldName] = this.parseFieldValue(value);
      }
    }
    
    // 处理位置参数
    if (meta) {
      // 使用已知的块定义
      let argIndex = 0;
      
      // 先分配字段（跳过已通过命名参数设置的）
      if (meta.fieldNames) {
        for (const fieldName of meta.fieldNames) {
          if (fieldName in fields || fieldName in inlineInputs) continue; // 已设置
          if (argIndex < positionalArgs.length) {
            fields[fieldName] = this.parseFieldValue(positionalArgs[argIndex]);
            argIndex++;
          }
        }
      }
      
      // 再分配值输入（跳过已通过命名参数设置的）
      if (meta.valueInputNames) {
        for (const inputName of meta.valueInputNames) {
          if (inputName in fields || inputName in inlineInputs) continue; // 已设置
          if (argIndex < positionalArgs.length) {
            const valueNode = this.parseInlineValue(positionalArgs[argIndex]);
            if (valueNode) {
              inlineInputs[inputName] = valueNode;
            }
            argIndex++;
          }
        }
      }
      
      // 处理剩余的位置参数（可能是动态扩展添加的字段）
      // 使用 EXTRA_0, EXTRA_1 等作为临时字段名
      let extraIndex = 0;
      while (argIndex < positionalArgs.length) {
        const arg = positionalArgs[argIndex];
        const fieldName = `EXTRA_${extraIndex}`;
        if (!this.isComplexExpression(arg)) {
          fields[fieldName] = this.parseFieldValue(arg);
        } else {
          const valueNode = this.parseInlineValue(arg);
          if (valueNode) {
            inlineInputs[fieldName] = valueNode;
          }
        }
        argIndex++;
        extraIndex++;
      }
    } else {
      // 未知块类型，尝试智能分配
      this.smartAssignArguments(blockType, positionalArgs, fields, inlineInputs);
    }
  }
  
  /**
   * 智能分配参数（用于未知块类型）
   */
  private smartAssignArguments(
    blockType: string,
    args: string[],
    fields: Record<string, any>,
    inlineInputs: Record<string, AbsNode>
  ): void {
    // 常见的字段名模式
    const commonFieldNames = ['SERIAL', 'PIN', 'MODE', 'OP', 'SPEED', 'VALUE', 'TEXT', 'NUM', 'VAR'];
    const commonInputNames = ['VAR', 'VALUE', 'A', 'B', 'NUM', 'BOOL', 'TEXT', 'PIN'];
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      // 检查是否是复杂表达式（包含函数调用或变量引用）
      if (this.isComplexExpression(arg)) {
        const inputName = i < commonInputNames.length ? commonInputNames[i] : `INPUT${i}`;
        const valueNode = this.parseInlineValue(arg);
        if (valueNode) {
          inlineInputs[inputName] = valueNode;
        }
      } else {
        // 简单值作为字段
        const fieldName = i < commonFieldNames.length ? commonFieldNames[i] : `FIELD${i}`;
        fields[fieldName] = this.parseFieldValue(arg);
      }
    }
  }
  
  /**
   * 检查是否是复杂表达式
   */
  private isComplexExpression(value: string): boolean {
    // 包含函数调用
    if (/\w+\(.+\)/.test(value)) {
      return true;
    }
    // 变量引用 $varName
    if (value.startsWith('$')) {
      return true;
    }
    // 特殊语法糖
    if (SYNTAX_SUGAR[value]) {
      return true;
    }
    return false;
  }
  
  /**
   * 解析字段值
   */
  private parseFieldValue(value: string): any {
    // 移除引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    
    // 变量字段 $varName
    if (value.startsWith('$')) {
      return { name: value.slice(1) };
    }
    
    // 数字
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return value;
    }
    
    // 布尔值
    if (value.toLowerCase() === 'true') return 'TRUE';
    if (value.toLowerCase() === 'false') return 'FALSE';
    
    // 其他作为字符串
    return value;
  }
  
  /**
   * 解析内联值表达式
   * 将表达式转换为 AbsNode
   */
  private parseInlineValue(value: string): AbsNode | null {
    value = value.trim();
    
    // 变量引用 $varName
    if (value.startsWith('$')) {
      const varName = value.slice(1);
      return {
        type: 'variables_get',
        fields: { VAR: { name: varName } },
        inputs: {},
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 检查语法糖
    if (SYNTAX_SUGAR[value]) {
      const result = SYNTAX_SUGAR[value]([]);
      return {
        type: result.type,
        fields: result.fields || {},
        inputs: {},
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 函数调用 func(args)
    const funcMatch = value.match(/^(\w+)\((.*)?\)$/);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const argsString = funcMatch[2] || '';
      const args = argsString ? this.parseArguments(argsString) : [];
      
      // 检查是否是语法糖
      if (SYNTAX_SUGAR[funcName]) {
        const result = SYNTAX_SUGAR[funcName](args);
        return {
          type: result.type,
          fields: result.fields || {},
          inputs: result.inputs || {},
          children: [],
          indent: 0,
          lineNumber: this.currentLine + 1,
          raw: value
        };
      }
      
      // 普通块调用
      const fields: Record<string, any> = {};
      const inputs: Record<string, AbsNode> = {};
      this.assignArguments(funcName, args, fields, inputs);
      
      return {
        type: funcName,
        fields,
        inputs,
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 字符串字面量
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return {
        type: 'text',
        fields: { TEXT: value.slice(1, -1) },
        inputs: {},
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 数字字面量
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return {
        type: 'math_number',
        fields: { NUM: value },
        inputs: {},
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 检查是否是已知的块类型
    if (isKnownBlock(value)) {
      return {
        type: value,
        fields: {},
        inputs: {},
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 检查是否看起来像块类型名（snake_case 标识符）
    if (/^[a-z][a-z0-9_]*$/i.test(value) && value.includes('_')) {
      // 可能是未知的块类型，尝试作为块处理
      this.warnings.push({
        line: this.currentLine + 1,
        message: `"${value}" 被识别为块类型（未在已加载的库中定义）`
      });
      return {
        type: value,
        fields: {},
        inputs: {},
        children: [],
        indent: 0,
        lineNumber: this.currentLine + 1,
        raw: value
      };
    }
    
    // 无法解析，返回文本块
    this.warnings.push({
      line: this.currentLine + 1,
      message: `无法识别的表达式 "${value}"，将作为文本处理`
    });
    
    return {
      type: 'text',
      fields: { TEXT: value },
      inputs: {},
      children: [],
      indent: 0,
      lineNumber: this.currentLine + 1,
      raw: value
    };
  }
  
  /**
   * 规范化输入名称
   */
  private normalizeInputName(name: string): string {
    const nameMap: Record<string, string> = {
      'condition': 'IF0',
      'if': 'IF0',
      'do': 'DO0',
      'then': 'DO0',
      'else': 'ELSE',
      'times': 'TIMES',
      'from': 'FROM',
      'to': 'TO',
      'by': 'BY',
      'value': 'VALUE',
      'list': 'LIST',
      'handler': 'HANDLER',
      'frame': 'FRAME',
    };
    
    return nameMap[name.toLowerCase()] || name.toUpperCase();
  }
  
  /**
   * 将 AbsNode 转换为 BlockConfig
   */
  private nodeToBlockConfig(node: AbsNode, position?: { x: number; y: number }): BlockConfig {
    const config: BlockConfig = {
      type: node.type,
      fields: {},
      inputs: {},
    };
    
    if (position) {
      config.position = position;
    }
    
    // 转换字段
    for (const [key, value] of Object.entries(node.fields)) {
      config.fields![key] = value;
    }
    
    // 转换输入
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) {
        // 语句输入（多个块）
        if (value.length > 0) {
          // 第一个块作为输入
          const firstBlock = this.nodeToBlockConfig(value[0]);
          
          // 后续块通过 next 连接
          let currentBlock = firstBlock;
          for (let i = 1; i < value.length; i++) {
            const nextBlock = this.nodeToBlockConfig(value[i]);
            currentBlock.next = { block: nextBlock };
            currentBlock = nextBlock;
          }
          
          config.inputs![key] = { block: firstBlock };
        }
      } else {
        // 值输入（单个块）
        const inputBlock = this.nodeToBlockConfig(value);
        // 统一使用 block 连接，让 Blockly 块定义自己处理 shadow
        // 注意：某些块定义中已内置默认 shadow，我们只需提供实际值块
        config.inputs![key] = { block: inputBlock };
      }
    }
    
    // 处理 next 连接（同级的下一个块）
    if (node.children.length > 0) {
      // 将 children 转换为 next 链
      let currentConfig = config;
      for (const child of node.children) {
        const childConfig = this.nodeToBlockConfig(child);
        currentConfig.next = { block: childConfig };
        currentConfig = childConfig;
      }
    }
    
    // 自动推断动态块的 extraState
    // 例如: controls_if 的 elseIfCount/hasElse, text_join 的 itemCount
    const extraState = inferExtraStateFromInputs(node.type, config.inputs || {});
    if (extraState) {
      config.extraState = extraState as BlockConfig['extraState'];
    }
    
    return config;
  }

  /**
   * 判断块类型是否应该作为 shadow 块
   * 基础值类型（text, math_number, logic_boolean, variables_get）使用 shadow
   */
  private isShadowBlockType(blockType: string): boolean {
    const shadowTypes = new Set([
      'text',
      'math_number',
      'logic_boolean',
      'variables_get'
    ]);
    return shadowTypes.has(blockType);
  }
}

// =============================================================================
// 动态块 extraState 自动推断
// =============================================================================

/**
 * 动态块配置
 * 用于根据输入自动推断 extraState
 */
const DYNAMIC_BLOCK_CONFIGS: Record<string, {
  inputPattern: RegExp;
  extraStateKey: string;
  defaultCount?: number;
}> = {
  'text_join': { inputPattern: /^ADD(\d+)$/, extraStateKey: 'itemCount', defaultCount: 2 },
  'lists_create_with': { inputPattern: /^ADD(\d+)$/, extraStateKey: 'itemCount', defaultCount: 3 },
  'controls_if': { inputPattern: /^(IF|DO)(\d+)$/, extraStateKey: 'elseIfCount' },
  'controls_ifelse': { inputPattern: /^(IF|DO)(\d+)$/, extraStateKey: 'elseIfCount' },
};

/**
 * 从 inputs 配置智能推断 extraState
 * 例如: 如果提供了 IF1, DO1，则推断 elseIfCount = 1
 */
function inferExtraStateFromInputs(
  blockType: string,
  inputs: Record<string, any>
): Record<string, any> | null {
  if (!inputs) return null;
  
  const config = DYNAMIC_BLOCK_CONFIGS[blockType];
  if (!config) return null;
  
  const inputKeys = Object.keys(inputs);
  
  // 特殊处理 controls_if/controls_ifelse
  if (blockType === 'controls_if' || blockType === 'controls_ifelse') {
    // 计算 IF 输入的最大编号（不包括 IF0）
    const ifNumbers = inputKeys
      .filter(key => /^IF\d+$/.test(key) && key !== 'IF0')
      .map(key => parseInt(key.replace('IF', ''), 10))
      .filter(n => !isNaN(n));
    
    const hasElse = inputKeys.includes('ELSE');
    
    const result: Record<string, any> = {};
    if (ifNumbers.length > 0) {
      result['elseIfCount'] = Math.max(...ifNumbers);
    }
    if (hasElse) {
      result['hasElse'] = true;
    }
    
    return Object.keys(result).length > 0 ? result : null;
  }
  
  // 通用处理：text_join, lists_create_with 等
  const pattern = config.inputPattern;
  const matchingInputs = inputKeys.filter(key => pattern.test(key));
  if (matchingInputs.length === 0) return null;
  
  // 提取最大编号
  const maxNumber = Math.max(...matchingInputs.map(key => {
    const match = key.match(pattern);
    return match ? parseInt(match[1] || match[2], 10) : -1;
  }));
  
  if (maxNumber < 0) return null;
  
  // itemCount = maxNumber + 1（因为从0开始）
  return { [config.extraStateKey]: maxNumber + 1 };
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 快速解析 ABS 代码
 * @param code ABS 源代码
 * @returns 解析结果
 */
export function parseAbs(code: string): AbsParseResult {
  const parser = new BlocklyAbsParser();
  return parser.parse(code);
}

/**
 * 生成 ABS 语法帮助文档
 */
export function getAbsSyntaxHelp(): string {
  return `
# Blockly ABS 语法指南 (Aily Block Syntax)

## 基本语法

### 变量定义
\`\`\`
@var count: int = 0
@var message: String = "hello"
\`\`\`

### 块调用
\`\`\`
block_type(arg1, arg2, ...)
\`\`\`

### 缩进表示层级
- 缩进的行表示在父块的语句输入内
- 同级换行表示 next 连接

## 特殊语法

### 变量引用
\`\`\`
$varName          # 引用变量
\`\`\`

### 字面量与语法糖
\`\`\`
"text"            # 文本 -> 自动创建 text 块
number(123)       # 数字 -> 创建 math_number 块
true / false      # 布尔值 -> 创建 logic_boolean 块
HIGH / LOW        # 高低电平 -> math_number(1/0)
\`\`\`

### 命名输入
\`\`\`
controls_if
    @condition: logic_compare(EQ, $a, $b)
    @do:
        serial_println(Serial, "Equal!")
    @else:
        serial_println(Serial, "Not equal")
\`\`\`

### 条件分支（if/elseif/else）
\`\`\`
# 简单 if
controls_if
    @IF0: logic_compare(GT, $count, number(10))
    @DO0:
        serial_println(Serial, "Greater than 10")

# if-else
controls_if
    @IF0: logic_compare(GT, $count, number(10))
    @DO0:
        serial_println(Serial, "Greater than 10")
    @ELSE:
        serial_println(Serial, "Not greater")

# if-elseif-else（extraState 自动推断）
controls_if
    @IF0: logic_compare(GT, $count, number(10))
    @DO0:
        serial_println(Serial, "Greater than 10")
    @IF1: logic_compare(GT, $count, number(5))
    @DO1:
        serial_println(Serial, "Greater than 5")
    @ELSE:
        serial_println(Serial, "5 or less")
\`\`\`

## 示例

### Arduino 基础程序
\`\`\`
@var count: int = 0

arduino_setup
    serial_begin(Serial, 115200)
    pin_mode(13, OUTPUT)

arduino_loop
    digital_write(13, HIGH)
    time_delay(number(500))
    digital_write(13, LOW)
    time_delay(number(500))
    math_change($count, number(1))
    serial_println(Serial, $count)
\`\`\`

### 条件判断
\`\`\`
controls_if
    @condition: logic_compare(GT, $count, number(10))
    @do:
        serial_println(Serial, "Count > 10")
        variables_set($count, number(0))
\`\`\`

### 循环
\`\`\`
controls_repeat_ext
    @times: number(5)
    @do:
        serial_println(Serial, "Hello")
        time_delay(number(1000))
\`\`\`
`;
}
