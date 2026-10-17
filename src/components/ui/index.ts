// Piezas comunes del rediseño (docs/UI_REDESIGN.md, fase 1). Las pantallas las
// importan de aquí; los tokens viven en src/theme (colors, fonts, ui).
export { Text, TextInput } from './Text';
export { TabBar } from './TabBar';
export type { TabBarItem } from './TabBar';
export { TopBar } from './TopBar';
export { ShortcutCircle } from './ShortcutCircle';
export { StepHeader } from './StepHeader';
export { Avatar, AvatarFrame } from './Avatar';
export { Chip, RemovableChip, StatusChip } from './Chip';
export { BottomSheet } from './BottomSheet';
export { Toggle } from './Toggle';
export { useConfirmDialog } from './ConfirmDialog';
export { focusRingWithin } from './webFocusRing';
