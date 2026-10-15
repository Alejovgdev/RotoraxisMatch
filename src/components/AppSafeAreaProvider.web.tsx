import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider as NativeSafeAreaProvider,
  type SafeAreaProviderProps,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

const consumedInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const ModalInsetsContext = createContext(consumedInsets);

export function useModalSafeAreaInsets() {
  return useContext(ModalInsetsContext);
}

export function SafeAreaProvider({ children, ...props }: SafeAreaProviderProps) {
  return (
    <NativeSafeAreaProvider {...props}>
      <ScreenInsets>{children}</ScreenInsets>
    </NativeSafeAreaProvider>
  );
}

function ScreenInsets({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const iphonePwa = typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-ajt-iphone-pwa');
  const value = useMemo(
    // +html still consumes the top and side insets. Bottom backgrounds now
    // reach the screen edge, with SafeAreaView/TabBar protecting their content.
    () => iphonePwa ? { ...consumedInsets, bottom: insets.bottom } : consumedInsets,
    [iphonePwa, insets.bottom],
  );
  return (
    <ModalInsetsContext.Provider value={value}>
      <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>
    </ModalInsetsContext.Provider>
  );
}

// Only the tab bar consumes the bottom inset when it is visible. Scope this to
// tab scenes so a detail pushed above the tabs still receives its own inset.
export function TabSceneSafeArea({ children, hasTabBar }: PropsWithChildren<{ hasTabBar: boolean }>) {
  const insets = useSafeAreaInsets();
  const value = useMemo(
    () => hasTabBar ? { ...insets, bottom: 0 } : insets,
    [hasTabBar, insets],
  );
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}
