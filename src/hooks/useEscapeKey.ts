import { useShortcut } from './useShortcut';

export function useEscapeKey(onClose: () => void, enabled = true) {
  useShortcut('close-modal', onClose, enabled);
}
