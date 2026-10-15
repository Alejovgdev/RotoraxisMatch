import type { PropsWithChildren } from 'react';

// Native platforms keep the exact same provider as before.
export { SafeAreaProvider } from 'react-native-safe-area-context';

export function TabSceneSafeArea({ children }: PropsWithChildren<{ hasTabBar: boolean }>) {
  return children;
}
