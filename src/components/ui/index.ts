// Piezas comunes del rediseño (docs/UI_REDESIGN.md, fase 1). Las pantallas las
// importan de aquí; los tokens viven en src/theme (colors, fonts, ui).
export { Text, TextInput } from './Text';
export { TabBar } from './TabBar';
export type { TabBarItem, TabBarAction } from './TabBar';
export { TopBar } from './TopBar';
export type { TopBarProps, TopBarSection } from './TopBar';
export { ShortcutCircle } from './ShortcutCircle';
export { StepHeader } from './StepHeader';
export { Avatar, AvatarFrame, avatarInitials, useAvatarImage } from './Avatar';
export type { AvatarImageSource } from './Avatar';
export { Chip, RemovableChip, StatusChip } from './Chip';
export { ListGroup, ListRow } from './ListRow';
export { BottomSheet } from './BottomSheet';
export { Toggle } from './Toggle';
export { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';
export type { ConfirmOptions } from './ConfirmDialog';
export { ModalBackdrop } from './ModalBackdrop';
export { focusRingWithin, installWebFocusRing } from './webFocusRing';
