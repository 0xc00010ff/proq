import type { AgentBlock } from './types';
import type { ToolGroupItem } from '@/components/blocks/ToolGroupBlock';

// ── RenderItem types ──

export type ToolResultBlock = Extract<AgentBlock, { type: 'tool_result' }>;

export type RenderItem =
  | { kind: 'block'; block: AgentBlock; idx: number }
  | { kind: 'tool_group'; toolName: string; items: (ToolGroupItem & { idx: number })[] }
  | { kind: 'ask_question'; toolId: string; input: Record<string, unknown>; result?: ToolResultBlock; idx: number }
  | { kind: 'plan_approval'; toolId: string; input: Record<string, unknown>; result?: ToolResultBlock; planContent?: string; planFilePath?: string; alreadyResponded: boolean; idx: number };

/**
 * Groups agent blocks into render items for display.
 * - Consecutive same-type tool_use blocks become tool_group items
 * - AskUserQuestion tool calls become ask_question items
 * - ExitPlanMode tool calls become plan_approval items (with backward scan for plan content)
 * - Optional mapToolUse callback for context-specific overrides (e.g. TaskUpdateBlock)
 */
export function groupBlocks(
  blocks: AgentBlock[],
  mapToolUse?: (block: Extract<AgentBlock, { type: 'tool_use' }>, idx: number, toolResultMap: Map<string, ToolResultBlock>) => RenderItem | null,
): RenderItem[] {
  // Build tool_use toolId -> tool_result pairing map
  const toolResultMap = new Map<string, ToolResultBlock>();
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResultMap.set(block.toolId, block);
    }
  }

  const renderItems: RenderItem[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'tool_result') continue;

    if (block.type === 'tool_use') {
      // AskUserQuestion → interactive question card
      if (block.name === 'AskUserQuestion') {
        renderItems.push({
          kind: 'ask_question',
          toolId: block.toolId,
          input: block.input,
          result: toolResultMap.get(block.toolId),
          idx: i,
        });
        continue;
      }

      // ExitPlanMode → plan approval card
      if (block.name === 'ExitPlanMode') {
        let planContent = block.input._planContent as string | undefined;
        let planFilePath = block.input._planFilePath as string | undefined;
        if (!planContent) {
          for (let j = i - 1; j >= 0; j--) {
            if (i - j > 50) break;
            const prev = blocks[j];
            if (prev.type === 'tool_use' && prev.name === 'Write') {
              const fp = prev.input.file_path as string;
              if (fp && fp.endsWith('.md')) {
                planContent = prev.input.content as string;
                planFilePath = fp;
                break;
              }
            }
            if (prev.type === 'tool_use' && prev.name === 'Edit') {
              const fp = prev.input.file_path as string;
              if (fp && fp.endsWith('.md') && prev.input.new_string) {
                planContent = prev.input.new_string as string;
                planFilePath = fp;
                break;
              }
            }
          }
        }
        let alreadyResponded = false;
        for (let j = i + 1; j < blocks.length; j++) {
          if (blocks[j].type === 'user') { alreadyResponded = true; break; }
        }
        renderItems.push({
          kind: 'plan_approval',
          toolId: block.toolId,
          input: block.input,
          result: toolResultMap.get(block.toolId),
          planContent,
          planFilePath,
          alreadyResponded,
          idx: i,
        });
        continue;
      }

      // Custom tool_use mapping (e.g. TaskUpdateBlock in task context)
      if (mapToolUse) {
        const custom = mapToolUse(block, i, toolResultMap);
        if (custom) {
          renderItems.push(custom);
          continue;
        }
      }

      // Default: group consecutive same-type tool_use blocks
      const last = renderItems[renderItems.length - 1];
      if (last?.kind === 'tool_group' && last.toolName === block.name) {
        last.items.push({
          toolId: block.toolId,
          name: block.name,
          input: block.input,
          result: toolResultMap.get(block.toolId),
          idx: i,
        });
      } else {
        renderItems.push({
          kind: 'tool_group',
          toolName: block.name,
          items: [{
            toolId: block.toolId,
            name: block.name,
            input: block.input,
            result: toolResultMap.get(block.toolId),
            idx: i,
          }],
        });
      }
    } else {
      renderItems.push({ kind: 'block', block, idx: i });
    }
  }

  return renderItems;
}

/** Check if the last block indicates the session has ended. */
export function isSessionEnded(blocks: AgentBlock[]): boolean {
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  return !!lastBlock && lastBlock.type === 'status' &&
    (lastBlock.subtype === 'complete' || lastBlock.subtype === 'error' || lastBlock.subtype === 'abort');
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
