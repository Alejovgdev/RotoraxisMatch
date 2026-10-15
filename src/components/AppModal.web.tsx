import { forwardRef } from 'react';
import { Modal as NativeModal, SafeAreaView as LegacySafeAreaView, type ModalProps, type View, type ViewProps } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView as InsetSafeAreaView } from 'react-native-safe-area-context';
import { useModalSafeAreaInsets } from './AppSafeAreaProvider.web';

export { useModalSafeAreaInsets };

// CountryCityPicker used the legacy RN view, which applies CSS env() itself.
// Keep it in browsers; the installed iPhone already consumes top/side insets.
export const SafeAreaView = forwardRef<View, ViewProps>((props, ref) => {
  const iphonePwa = typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-ajt-iphone-pwa');
  const Component = iphonePwa ? InsetSafeAreaView : LegacySafeAreaView;
  return <Component {...props} ref={ref} />;
});

export function Modal({ children, ...props }: ModalProps) {
  const insets = useModalSafeAreaInsets();
  return (
    <NativeModal {...props}>
      {/* Portals cover the bottom edge even when opened from a tab scene. */}
      <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>
    </NativeModal>
  );
}
