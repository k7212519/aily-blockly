/**
 * ABS 文件同步工具
 * 
 * 提供 Blockly 工作区与 project.abs 文件之间的同步操作
 */

import { convertAbiToAbs, convertAbsToAbi } from './abiAbsConverter';
import { getActiveWorkspace, createBlockFromConfig } from './editBlockTool';
import { AbsAutoSyncService } from '../services/abs-auto-sync.service';
import { loadProjectBlockDefinitions, parseAbs, BlocklyAbsParser } from './absParser';

declare const Blockly: any;

// =============================================================================
// 类型定义
// =============================================================================

interface SyncAbsArgs {
  operation: 'export' | 'import' | 'status';
  includeHeader?: boolean;
}

interface SyncAbsResult {
  is_error: boolean;
  content: string;
  metadata?: {
    operation: string;
    filePath?: string;
    absPreview?: string;
    blockCount?: number;
    variableCount?: number;
    versionSaved?: boolean;
  };
}

// =============================================================================
// 工具处理函数
// =============================================================================

/**
 * ABS 文件同步处理
 */
export async function syncAbsFileHandler(
  args: SyncAbsArgs,
  projectService: any,
  electronService: any,
  absAutoSyncService?: AbsAutoSyncService
): Promise<SyncAbsResult> {
  const { operation, includeHeader = true } = args;
  
  // 获取项目路径（优先使用当前项目路径，否则使用根路径）
  const projectPath = projectService?.currentProjectPath || projectService?.projectRootPath;
  if (!projectPath) {
    return {
      is_error: true,
      content: '无法获取当前项目路径，请先打开一个项目'
    };
  }
  
  // 加载项目的块定义
  loadProjectBlockDefinitions(projectPath);
  
  const absFilePath = `${projectPath}/project.abs`;
  const abiFilePath = `${projectPath}/project.abi`;
  
  switch (operation) {
    case 'export':
      return await exportToAbs(abiFilePath, absFilePath, includeHeader, electronService);
    
    case 'import':
      return await importFromAbs(absFilePath, abiFilePath, electronService, absAutoSyncService);
    
    case 'status':
      return await getAbsStatus(absFilePath, abiFilePath, electronService);
    
    default:
      return {
        is_error: true,
        content: `未知操作: ${operation}`
      };
  }
}

/**
 * 导出 Blockly 工作区到 ABS 文件
 */
async function exportToAbs(
  abiFilePath: string,
  absFilePath: string,
  includeHeader: boolean,
  electronService: any
): Promise<SyncAbsResult> {
  try {
    // 方法1：从工作区获取
    const workspace = getActiveWorkspace();
    let abiJson: any;
    
    if (workspace) {
      // 直接从工作区序列化
      abiJson = Blockly.serialization.workspaces.save(workspace);
    } else if (electronService.exists(abiFilePath)) {
      // 方法2：从 ABI 文件读取
      const abiContent = electronService.readFile(abiFilePath);
      abiJson = JSON.parse(abiContent);
    } else {
      return {
        is_error: true,
        content: '无法获取 Blockly 工作区或 ABI 文件'
      };
    }
    
    // 转换为 ABS 格式
    const absContent = convertAbiToAbs(abiJson, { includeHeader });
    
    // 写入 ABS 文件
    electronService.writeFile(absFilePath, absContent);
    
    // 统计信息
    const blockCount = countBlocks(abiJson);
    const variableCount = abiJson.variables?.length || 0;
    
    // 生成预览（前 30 行）
    const absLines = absContent.split('\n');
    const preview = absLines.slice(0, 30).join('\n') + 
      (absLines.length > 30 ? '\n... (more lines)' : '');
    
    return {
      is_error: false,
      content: `✅ 已导出 ABS 文件

**文件路径:** \`${absFilePath}\`
**统计:** ${blockCount} 个块, ${variableCount} 个变量

**ABS 预览:**
\`\`\`
${preview}
\`\`\`

**下一步操作建议:**
1. 使用 \`read_file\` 读取完整的 ABS 文件
2. 使用 \`edit_file\` 修改 ABS 内容
3. 修改完成后使用 \`sync_abs_file(operation: "import")\` 应用更改`,
      metadata: {
        operation: 'export',
        filePath: absFilePath,
        absPreview: preview,
        blockCount,
        variableCount
      }
    };
  } catch (error) {
    return {
      is_error: true,
      content: `导出失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * 从 ABS 文件导入到 Blockly 工作区
 * 使用 createBlockFromConfig 直接创建块，支持动态扩展
 */
async function importFromAbs(
  absFilePath: string,
  abiFilePath: string,
  electronService: any,
  absAutoSyncService?: AbsAutoSyncService
): Promise<SyncAbsResult> {
  try {
    // 检查 ABS 文件是否存在
    if (!electronService.exists(absFilePath)) {
      return {
        is_error: true,
        content: `ABS 文件不存在: ${absFilePath}\n\n请先使用 \`sync_abs_file(operation: "export")\` 生成 ABS 文件`
      };
    }
    
    // 在修改前保存当前版本（AI 修改时的版本控制）
    // 注意：使用 getWorkspaceAbsContent 而不是 exportToAbs，避免覆盖用户编辑的 ABS 文件
    let versionSaved = false;
    if (absAutoSyncService) {
      try {
        // 获取当前工作区内容并保存版本（不写入文件）
        const currentAbs = absAutoSyncService.getWorkspaceAbsContent();
        if (currentAbs) {
          const version = await absAutoSyncService.saveVersion(currentAbs, 'AI 修改前备份');
          versionSaved = !!version;
        }
      } catch (e) {
        console.warn('[syncAbsFile] 保存版本失败:', e);
      }
    }
    
    // 读取 ABS 文件
    const absContent = electronService.readFile(absFilePath);
    
    // 解析 ABS（不转换为 ABI JSON，而是获取 BlockConfig）
    const parser = new BlocklyAbsParser();
    const parseResult = parser.parse(absContent);
    
    if (!parseResult.success) {
      const errorMessages = parseResult.errors
        ?.map(e => `第 ${e.line} 行: ${e.message}`)
        .join('\n') || '未知错误';
      
      return {
        is_error: true,
        content: `ABS 解析失败:\n${errorMessages}\n\n请检查 ABS 文件语法，读取对应库 reademe_ai.md 或使用 \`get_block_info_tool\` 查询正确的块定义和参数格式。`
      };
    }
    
    // 获取工作区
    const workspace = getActiveWorkspace();
    if (!workspace) {
      return {
        is_error: true,
        content: '无法获取 Blockly 工作区'
      };
    }
    
    // 备份当前 ABI 文件
    if (electronService.exists(abiFilePath)) {
      const backupPath = `${abiFilePath}.backup`;
      const currentAbi = electronService.readFile(abiFilePath);
      electronService.writeFile(backupPath, currentAbi);
    }
    
    // 收集所有变量：从 @var 声明 + 从 $varName 引用自动推断
    const allVariables = new Map<string, string>(); // name → type
    
    // 🆕 收集会被初始化块自动创建的变量（如 dht_init 的第一个参数）
    // 这些变量不需要预先创建，让 Blockly 扩展自动创建带正确类型的变量
    const autoCreatedVars = collectAutoCreatedVariables(parseResult.rootBlocks);
    if (autoCreatedVars.size > 0) {
      console.log(`📋 检测到初始化块自动创建的变量: ${Array.from(autoCreatedVars).join(', ')}`);
    }
    
    // 1. 从显式 @var 声明中收集（如果有）
    for (const varDef of parseResult.variables) {
      allVariables.set(varDef.name, varDef.type);
    }
    
    // 2. 从 $varName 引用中自动收集（扫描所有块）
    // 🆕 排除会被初始化块自动创建的变量
    const inferredVars = collectVariableReferences(parseResult.rootBlocks);
    for (const varName of inferredVars) {
      if (!allVariables.has(varName) && !autoCreatedVars.has(varName)) {
        allVariables.set(varName, ''); // 类型未知，使用默认
        console.log(`🔍 自动推断变量: "${varName}" (从 $${varName} 引用)`);
      } else if (autoCreatedVars.has(varName)) {
        console.log(`⏭️ 跳过变量: "${varName}" (将由初始化块自动创建)`);
      }
    }
    
    // 同步变量到工作区（只创建不存在的变量）
    const variableNameToId = new Map<string, string>();
    const existingVars = workspace.getAllVariables();
    const existingVarNames = new Set(existingVars.map((v: any) => v.name));
    
    let newVarCount = 0;
    for (const [name, type] of allVariables) {
      if (!existingVarNames.has(name)) {
        const variable = workspace.createVariable(name, type || undefined);
        variableNameToId.set(name, variable.getId());
        newVarCount++;
        console.log(`✅ 创建变量: "${name}" (类型: ${type || '默认'}) → ID: ${variable.getId()}`);
      } else {
        // 变量已存在，获取其 ID
        const existing = existingVars.find((v: any) => v.name === name);
        if (existing) {
          variableNameToId.set(name, existing.getId());
        }
      }
    }
    console.log(`📋 新建 ${newVarCount} 个变量，复用 ${allVariables.size - newVarCount} 个已有变量`);
    
    // 🆕 尝试增量更新
    const hasExistingBlocks = workspace.getTopBlocks(false).length > 0;
    let updateResult: { added: number; removed: number; unchanged: number; failedBlocks: any[] } | null = null;
    let useIncrementalUpdate = hasExistingBlocks;
    
    if (useIncrementalUpdate) {
      console.log('🔄 尝试增量更新...');
      try {
        updateResult = await incrementalUpdate(
          workspace,
          parseResult.rootBlocks,
          variableNameToId,
          preprocessVariableReferences
        );
        console.log(`📊 增量更新完成: +${updateResult.added}, -${updateResult.removed}, =${updateResult.unchanged}`);
      } catch (e) {
        console.warn('⚠️ 增量更新失败，回退到全量更新:', e);
        useIncrementalUpdate = false;
      }
    }
    
    // 如果增量更新失败或没有现有块，使用全量更新
    let totalBlocks = 0;
    const failedBlocks: Array<{ blockType: string; error: string; suggestion?: string }> = [];
    
    if (!useIncrementalUpdate) {
      console.log('🔄 执行全量更新（清空并重建）...');
      // 清空当前工作区
      workspace.clear();
      
      // 重新创建变量
      variableNameToId.clear();
      for (const [name, type] of allVariables) {
        const variable = workspace.createVariable(name, type || undefined);
        variableNameToId.set(name, variable.getId());
      }
      
      let yPosition = 30;
      for (const blockConfig of parseResult.rootBlocks) {
        // 设置位置
        const configWithPosition = {
          ...blockConfig,
          position: { x: 30, y: yPosition }
        };
        
        // 预处理：将变量名转换为变量 ID
        preprocessVariableReferences(configWithPosition, variableNameToId);
        
        try {
          const result = await createBlockFromConfig(workspace, configWithPosition);
          if (result.block) {
            totalBlocks += result.totalBlocks;
            yPosition += calculateBlockHeight(result.block) + 50;
          }
          if (result.failedBlocks && result.failedBlocks.length > 0) {
            failedBlocks.push(...result.failedBlocks);
          }
        } catch (error) {
          console.warn(`创建块失败: ${blockConfig.type}`, error);
          failedBlocks.push({
            blockType: blockConfig.type,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } else {
      // 使用增量更新结果
      totalBlocks = (updateResult?.added || 0) + (updateResult?.unchanged || 0);
      if (updateResult?.failedBlocks) {
        failedBlocks.push(...updateResult.failedBlocks);
      }
    }
    
    // 保存工作区到 ABI 文件
    const abiJson = Blockly.serialization.workspaces.save(workspace);
    electronService.writeFile(abiFilePath, JSON.stringify(abiJson, null, 2));
    
    const variableCount = allVariables.size;  // 使用收集到的所有变量数量
    
    // 警告信息
    let warnings = '';
    if (parseResult.warnings && parseResult.warnings.length > 0) {
      warnings = '\n\n**⚠️ 警告:**\n' + 
        parseResult.warnings.map(w => `- 第 ${w.line} 行: ${w.message}`).join('\n');
    }
    
    // 更新模式信息
    let updateModeInfo = '';
    if (useIncrementalUpdate && updateResult) {
      updateModeInfo = `\n**更新模式:** 增量更新 (新增 ${updateResult.added}, 删除 ${updateResult.removed}, 保持 ${updateResult.unchanged})`;
    } else {
      updateModeInfo = '\n**更新模式:** 全量重建';
    }
    
    // 失败的块
    let failedInfo = '';
    if (failedBlocks.length > 0) {
      failedInfo = '\n\n**❌ 创建失败的块 (' + failedBlocks.length + ' 个):**\n';
      
      for (const f of failedBlocks) {
        failedInfo += `- \`${f.blockType}\`: ${f.error}\n`;
      }
      
      failedInfo += '\n**🔧 修复建议:**\n';
      failedInfo += '1. 检查块类型是否拼写正确\n';
      failedInfo += '2. 使用 `get_block_info_tool` 查询正确的块名和参数格式\n';
      failedInfo += '3. 阅读对应库的 README 了解块的使用方法\n';
      failedInfo += '4. 如果多次尝试仍失败，考虑使用 `lib-core-custom` 的自定义代码块\n';
    }
    
    // 版本信息
    const versionInfo = versionSaved ? '\n**版本:** 修改前状态已自动保存到版本历史' : '';
    
    return {
      is_error: false,
      content: `✅ 已从 ABS 文件导入

**统计:** ${totalBlocks} 个块, ${variableCount} 个变量${updateModeInfo}
**备份:** 原 ABI 文件已备份为 \`project.abi.backup\`${versionInfo}${warnings}${failedInfo}

工作区已更新，请检查 Blockly 编辑器中的效果。`,
      metadata: {
        operation: 'import',
        filePath: absFilePath,
        blockCount: totalBlocks,
        variableCount,
        versionSaved
      }
    };
  } catch (error) {
    return {
      is_error: true,
      content: `导入失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * 从块配置中收集所有变量引用（$varName 格式）
 * 用于自动创建 Blockly 工作区变量
 */
function collectVariableReferences(blocks: any[]): Set<string> {
  const varNames = new Set<string>();
  
  function collectFromConfig(config: any): void {
    if (!config) return;
    
    // 从字段中收集变量引用
    if (config.fields) {
      for (const value of Object.values(config.fields)) {
        if (typeof value === 'object' && value !== null && (value as any).name) {
          varNames.add((value as any).name);
        }
      }
    }
    
    // 递归处理输入
    if (config.inputs) {
      for (const input of Object.values(config.inputs)) {
        const inputConfig = input as any;
        if (inputConfig.block) {
          collectFromConfig(inputConfig.block);
        }
        if (inputConfig.shadow) {
          collectFromConfig(inputConfig.shadow);
        }
      }
    }
    
    // 处理 next
    if (config.next?.block) {
      collectFromConfig(config.next.block);
    }
  }
  
  for (const block of blocks) {
    collectFromConfig(block);
  }
  
  return varNames;
}

/**
 * 🆕 收集会被初始化块自动创建的变量
 * 这些块（如 dht_init, servo_init 等）的第一个字符串参数是变量名，
 * Blockly 扩展会自动创建带正确类型的变量
 */
function collectAutoCreatedVariables(blocks: any[]): Set<string> {
  const autoCreatedVars = new Set<string>();
  
  // 已知会自动创建变量的初始化块模式
  // 块类型 → 包含变量名的字段名
  const initBlockPatterns: Record<string, string> = {
    'dht_init': 'VAR',
    'servo_init': 'VAR',
    'stepper_init': 'VAR',
    'lcd_init': 'VAR',
    'oled_init': 'VAR',
    'neopixel_init': 'VAR',
    'motor_init': 'VAR',
    'ultrasonic_init': 'VAR',
    'ir_init': 'VAR',
    'mqtt_init': 'VAR',
    'ntpclient_create': 'VAR',
    // 可以根据需要添加更多
  };
  
  function collectFromConfig(config: any): void {
    if (!config) return;
    
    // 检查是否是初始化块
    const varFieldName = initBlockPatterns[config.type];
    if (varFieldName && config.fields) {
      const varValue = config.fields[varFieldName];
      if (varValue) {
        // 变量名可能是字符串或 { name: "xxx" } 对象
        const varName = typeof varValue === 'string' ? varValue : varValue.name;
        if (varName) {
          autoCreatedVars.add(varName);
        }
      }
    }
    
    // 递归处理输入
    if (config.inputs) {
      for (const input of Object.values(config.inputs)) {
        const inputConfig = input as any;
        if (inputConfig.block) {
          collectFromConfig(inputConfig.block);
        }
      }
    }
    
    // 处理 next
    if (config.next?.block) {
      collectFromConfig(config.next.block);
    }
  }
  
  for (const block of blocks) {
    collectFromConfig(block);
  }
  
  return autoCreatedVars;
}

/**
 * 预处理变量引用：将 { name: "varName" } 转换为 Blockly 可识别的格式
 */
function preprocessVariableReferences(
  config: any, 
  variableNameToId: Map<string, string>
): void {
  // 处理字段中的变量引用
  if (config.fields) {
    for (const [key, value] of Object.entries(config.fields)) {
      if (typeof value === 'object' && value !== null && (value as any).name) {
        const varName = (value as any).name;
        const varId = variableNameToId.get(varName);
        if (varId) {
          // Blockly 需要 id 字段
          config.fields[key] = { id: varId, name: varName, type: '' };
        }
      }
    }
  }
  
  // 递归处理输入
  if (config.inputs) {
    for (const input of Object.values(config.inputs)) {
      const inputConfig = input as any;
      if (inputConfig.block) {
        preprocessVariableReferences(inputConfig.block, variableNameToId);
      }
      if (inputConfig.shadow) {
        preprocessVariableReferences(inputConfig.shadow, variableNameToId);
      }
    }
  }
  
  // 处理 next
  if (config.next?.block) {
    preprocessVariableReferences(config.next.block, variableNameToId);
  }
}

/**
 * 计算块的实际高度
 */
function calculateBlockHeight(block: any): number {
  if (!block) return 50;
  
  try {
    // 尝试获取块的实际高度
    if (block.height) {
      return block.height;
    }
    
    // 回退到估算
    let height = 50;
    
    // 计算子块高度
    const inputs = block.inputList || [];
    for (const input of inputs) {
      if (input.connection && input.connection.targetBlock()) {
        height += calculateBlockHeight(input.connection.targetBlock());
      }
    }
    
    // 计算 next 链
    if (block.nextConnection && block.nextConnection.targetBlock()) {
      height += calculateBlockHeight(block.nextConnection.targetBlock());
    }
    
    return height;
  } catch {
    return 50;
  }
}

/**
 * 获取 ABS 文件状态
 */
async function getAbsStatus(
  absFilePath: string,
  abiFilePath: string,
  electronService: any
): Promise<SyncAbsResult> {
  try {
    const absExists = electronService.exists(absFilePath);
    const abiExists = electronService.exists(abiFilePath);
    
    let content = `## ABS 文件状态\n\n`;
    content += `**ABS 文件:** ${absFilePath}\n`;
    content += `**状态:** ${absExists ? '✅ 存在' : '❌ 不存在'}\n\n`;
    content += `**ABI 文件:** ${abiFilePath}\n`;
    content += `**状态:** ${abiExists ? '✅ 存在' : '❌ 不存在'}\n\n`;
    
    let blockCount = 0;
    let variableCount = 0;
    let absPreview = '';
    
    if (absExists) {
      const absContent = electronService.readFile(absFilePath);
      const lines = absContent.split('\n');
      absPreview = lines.slice(0, 20).join('\n') + 
        (lines.length > 20 ? '\n... (more lines)' : '');
      
      content += `**ABS 内容预览:**\n\`\`\`\n${absPreview}\n\`\`\`\n\n`;
      
      // 统计
      const nonEmptyLines = lines.filter(l => l.trim() && !l.trim().startsWith('#'));
      content += `**ABS 行数:** ${lines.length} (非空非注释: ${nonEmptyLines.length})\n`;
    }
    
    if (abiExists) {
      const abiContent = electronService.readFile(abiFilePath);
      const abiJson = JSON.parse(abiContent);
      blockCount = countBlocks(abiJson);
      variableCount = abiJson.variables?.length || 0;
      
      content += `**ABI 块数:** ${blockCount}\n`;
      content += `**ABI 变量数:** ${variableCount}\n`;
    }
    
    content += `\n**建议操作:**\n`;
    if (!absExists && abiExists) {
      content += `- 使用 \`sync_abs_file(operation: "export")\` 生成 ABS 文件\n`;
    } else if (absExists) {
      content += `- 使用 \`read_file\` 读取完整 ABS 内容\n`;
      content += `- 使用 \`edit_file\` 修改后 \`sync_abs_file(operation: "import")\` 应用\n`;
    }
    
    return {
      is_error: false,
      content,
      metadata: {
        operation: 'status',
        filePath: absFilePath,
        absPreview,
        blockCount,
        variableCount
      }
    };
  } catch (error) {
    return {
      is_error: true,
      content: `获取状态失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * 统计块数量
 */
function countBlocks(abiJson: any): number {
  let count = 0;
  
  function countRecursive(block: any): void {
    if (!block) return;
    count++;
    
    // 统计输入中的块
    if (block.inputs) {
      for (const input of Object.values(block.inputs)) {
        const inputConfig = input as any;
        if (inputConfig.block) countRecursive(inputConfig.block);
        if (inputConfig.shadow) countRecursive(inputConfig.shadow);
      }
    }
    
    // 统计 next 块
    if (block.next?.block) {
      countRecursive(block.next.block);
    }
  }
  
  if (abiJson.blocks?.blocks) {
    for (const block of abiJson.blocks.blocks) {
      countRecursive(block);
    }
  }
  
  return count;
}

// =============================================================================
// 增量更新辅助函数
// =============================================================================

/**
 * 规范化字段值用于签名比较
 * 统一处理变量字段、普通字段的格式差异
 */
function normalizeFieldValue(value: any): string {
  if (value === null || value === undefined) return '';
  
  if (typeof value === 'object') {
    // 变量字段：优先使用 name，因为 ABS 和工作区都有 name
    if ('name' in value) {
      return `var:${value.name}`;
    }
    if ('id' in value) {
      return `id:${value.id}`;
    }
    return JSON.stringify(value);
  }
  
  return String(value);
}

/**
 * 计算块链的签名（用于比较是否相同）
 * 签名包含：块类型、字段值、输入连接、next 连接
 * 注意：不包含位置信息和块 ID
 */
function computeBlockChainSignature(block: any): string {
  if (!block) return '';
  
  const parts: string[] = [];
  
  // 块类型
  parts.push(`T:${block.type}`);
  
  // 字段值（排序后连接，跳过空值）
  if (block.fields) {
    const fieldPairs = Object.entries(block.fields)
      .filter(([_, v]) => v !== null && v !== undefined && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${normalizeFieldValue(v)}`);
    if (fieldPairs.length > 0) {
      parts.push(`F:{${fieldPairs.join(',')}}`);
    }
  }
  
  // extraState（如果有且非空）
  if (block.extraState && Object.keys(block.extraState).length > 0) {
    parts.push(`E:${JSON.stringify(block.extraState)}`);
  }
  
  // 输入连接（递归计算子块签名）
  if (block.inputs) {
    const inputSigs = Object.entries(block.inputs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, input]: [string, any]) => {
        const blockSig = input.block ? computeBlockChainSignature(input.block) : '';
        const shadowSig = input.shadow ? computeBlockChainSignature(input.shadow) : '';
        // 只有当有内容时才包含
        if (blockSig || shadowSig) {
          return `${name}:[${blockSig}|${shadowSig}]`;
        }
        return null;
      })
      .filter(Boolean);
    if (inputSigs.length > 0) {
      parts.push(`I:{${inputSigs.join(',')}}`);
    }
  }
  
  // next 连接
  if (block.next?.block) {
    parts.push(`N:${computeBlockChainSignature(block.next.block)}`);
  }
  
  return parts.join('|');
}

/**
 * 将 Blockly 工作区中的块序列化为与 ABS 解析结果相同的格式
 * 重要：输出格式必须与 ABS 解析器的 BlockConfig 格式一致
 */
function serializeWorkspaceBlock(block: any): any {
  if (!block) return null;
  
  const result: any = {
    type: block.type
  };
  
  // 序列化字段
  const fields: any = {};
  for (const input of block.inputList || []) {
    for (const field of input.fieldRow || []) {
      if (field.name && field.getValue) {
        const value = field.getValue();
        // 变量字段特殊处理：使用 { name: varName } 格式，与 ABS 解析结果一致
        if (field.getVariable) {
          const variable = field.getVariable();
          if (variable) {
            // 只保留 name，与 ABS 解析结果格式一致
            fields[field.name] = { name: variable.name };
          }
        } else if (value !== undefined && value !== null && value !== '') {
          fields[field.name] = value;
        }
      }
    }
  }
  if (Object.keys(fields).length > 0) {
    result.fields = fields;
  }
  
  // 序列化 extraState（只有非空时才添加）
  if (block.saveExtraState) {
    try {
      const extraState = block.saveExtraState();
      if (extraState && Object.keys(extraState).length > 0) {
        result.extraState = extraState;
      }
    } catch (e) {
      // 忽略
    }
  }
  
  // 序列化输入
  const inputs: any = {};
  for (const input of block.inputList || []) {
    if (input.connection && input.name) {
      const connectedBlock = input.connection.targetBlock();
      if (connectedBlock) {
        const isShadow = connectedBlock.isShadow();
        const serialized = serializeWorkspaceBlock(connectedBlock);
        if (serialized) {
          if (isShadow) {
            inputs[input.name] = { shadow: serialized };
          } else {
            inputs[input.name] = { block: serialized };
          }
        }
      }
    }
  }
  if (Object.keys(inputs).length > 0) {
    result.inputs = inputs;
  }
  
  // 序列化 next
  if (block.nextConnection) {
    const nextBlock = block.nextConnection.targetBlock();
    if (nextBlock) {
      const serialized = serializeWorkspaceBlock(nextBlock);
      if (serialized) {
        result.next = { block: serialized };
      }
    }
  }
  
  return result;
}

/**
 * 获取工作区中所有根块（顶层块）
 */
function getWorkspaceRootBlocks(workspace: any): any[] {
  const topBlocks = workspace.getTopBlocks(false);
  return topBlocks.map((block: any) => ({
    block,
    serialized: serializeWorkspaceBlock(block),
    signature: computeBlockChainSignature(serializeWorkspaceBlock(block))
  }));
}

/**
 * 增量更新工作区
 * 返回操作统计
 */
async function incrementalUpdate(
  workspace: any,
  newBlocks: any[],
  variableNameToId: Map<string, string>,
  preprocessVariableReferences: (config: any, mapping: Map<string, string>) => void
): Promise<{
  added: number;
  removed: number;
  unchanged: number;
  failedBlocks: Array<{ blockType: string; error: string; suggestion?: string }>;
}> {
  const failedBlocks: Array<{ blockType: string; error: string; suggestion?: string }> = [];
  
  // 获取当前工作区的根块及其签名
  const currentRootBlocks = getWorkspaceRootBlocks(workspace);
  console.log(`📊 当前工作区有 ${currentRootBlocks.length} 个根块`);
  
  // 🔍 调试：输出当前工作区块的签名
  for (const item of currentRootBlocks) {
    console.log(`  📌 当前块 ${item.serialized.type}: ${item.signature.substring(0, 100)}...`);
  }
  
  // 计算新块的签名（不预处理变量，使用变量名计算签名）
  const newBlocksWithSignatures = newBlocks.map(config => {
    // 不对签名计算使用预处理，确保使用变量名而不是 ID
    return {
      config: config,
      originalConfig: config,
      signature: computeBlockChainSignature(config)
    };
  });
  console.log(`📊 新 ABS 有 ${newBlocksWithSignatures.length} 个根块`);
  
  // 🔍 调试：输出新 ABS 块的签名
  for (const item of newBlocksWithSignatures) {
    console.log(`  📌 新块 ${item.config.type}: ${item.signature.substring(0, 100)}...`);
  }
  
  // 创建签名到块的映射
  const currentSignatureMap = new Map<string, any>();
  for (const item of currentRootBlocks) {
    currentSignatureMap.set(item.signature, item);
  }
  
  const newSignatureMap = new Map<string, any>();
  for (const item of newBlocksWithSignatures) {
    newSignatureMap.set(item.signature, item);
  }
  
  // 计算差异
  const toRemove: any[] = []; // 需要删除的块
  const toAdd: any[] = [];    // 需要添加的块配置
  const unchanged: any[] = []; // 不变的块
  
  // 找出需要删除的块（当前有但新 ABS 没有）
  for (const [signature, item] of currentSignatureMap) {
    if (!newSignatureMap.has(signature)) {
      toRemove.push(item.block);
    } else {
      unchanged.push(item);
    }
  }
  
  // 找出需要添加的块（新 ABS 有但当前没有）
  for (const [signature, item] of newSignatureMap) {
    if (!currentSignatureMap.has(signature)) {
      toAdd.push(item.originalConfig);
    }
  }
  
  console.log(`📊 差异分析: 删除 ${toRemove.length}, 添加 ${toAdd.length}, 不变 ${unchanged.length}`);
  
  // 执行删除
  for (const block of toRemove) {
    try {
      console.log(`🗑️ 删除块: ${block.type} (ID: ${block.id})`);
      block.dispose(true);
    } catch (e) {
      console.warn(`删除块失败: ${block.type}`, e);
    }
  }
  
  // 执行添加
  let yPosition = 30;
  // 计算起始 Y 位置（避免与现有块重叠）
  const existingBlocks = workspace.getTopBlocks(false);
  for (const block of existingBlocks) {
    const bounds = block.getBoundingRectangle();
    if (bounds) {
      yPosition = Math.max(yPosition, bounds.bottom + 50);
    }
  }
  
  let addedCount = 0;
  for (const config of toAdd) {
    const configWithPosition = {
      ...config,
      position: { x: 30, y: yPosition }
    };
    
    // 预处理变量引用
    preprocessVariableReferences(configWithPosition, variableNameToId);
    
    try {
      const result = await createBlockFromConfig(workspace, configWithPosition);
      if (result.block) {
        addedCount++;
        const bounds = result.block.getBoundingRectangle();
        if (bounds) {
          yPosition = bounds.bottom + 50;
        } else {
          yPosition += 100;
        }
      }
      if (result.failedBlocks && result.failedBlocks.length > 0) {
        failedBlocks.push(...result.failedBlocks);
      }
    } catch (error) {
      console.warn(`添加块失败: ${config.type}`, error);
      failedBlocks.push({
        blockType: config.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // 🆕 清理多余的独立块（可能是之前失败导入产生的）
  // 增量更新后，工作区应该只有新 ABS 定义的根块
  const finalTopBlocks = workspace.getTopBlocks(false);
  const expectedRootBlockCount = newBlocks.length;
  
  if (finalTopBlocks.length > expectedRootBlockCount) {
    console.log(`⚠️ 检测到多余的独立块: 期望 ${expectedRootBlockCount} 个，实际 ${finalTopBlocks.length} 个`);
    
    // 重新计算当前工作区所有根块的签名
    const finalSignatures = new Set<string>();
    for (const block of finalTopBlocks) {
      const serialized = serializeWorkspaceBlock(block);
      const signature = computeBlockChainSignature(serialized);
      
      // 检查这个签名是否在新 ABS 的根块中（而不是子块）
      if (newSignatureMap.has(signature)) {
        finalSignatures.add(signature);
      } else {
        // 这是一个不该存在的独立块，删除它
        console.log(`🧹 清理多余独立块: ${block.type} (ID: ${block.id})`);
        try {
          block.dispose(true);
        } catch (e) {
          console.warn(`清理块失败: ${block.type}`, e);
        }
      }
    }
  }
  
  return {
    added: addedCount,
    removed: toRemove.length,
    unchanged: unchanged.length,
    failedBlocks
  };
}
