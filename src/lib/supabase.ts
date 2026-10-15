import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// AsyncStorage uses `window` internally which crashes during Expo web SSR.
// This wrapper makes every call a no-op in the Node/SSR environment.
const ssrSafeStorage = {
  getItem: (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return Promise.resolve();
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string): Promise<void> => {
    if (typeof window === 'undefined') return Promise.resolve();
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: ssrSafeStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth or magic links in V2S1 — avoid URL hash interference with Expo Router
    detectSessionInUrl: false,
  },
});

// On iOS/Android timers are suspended in the background, so the token can
// expire unnoticed. Supabase's React Native recipe: refresh only while the app
// is in the foreground, which also refreshes right away on return. Registered
// once, at module load. Not on web: the client already follows page
// visibility there, and stopAutoRefresh() would remove that handler.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
