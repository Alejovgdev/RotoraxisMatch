import {
  SafeAreaInsetsContext,
  SafeAreaProvider as NativeSafeAreaProvider,
  type SafeAreaProviderProps,
} from 'react-native-safe-area-context';

const consumedInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function SafeAreaProvider({ children, ...props }: SafeAreaProviderProps) {
  return (
    <NativeSafeAreaProvider {...props}>
      {/* +html reserves the safe edges for every screen and portaled modal. */}
      <SafeAreaInsetsContext.Provider value={consumedInsets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </NativeSafeAreaProvider>
  );
}
