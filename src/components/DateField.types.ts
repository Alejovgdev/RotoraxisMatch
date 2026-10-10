export interface DateFieldPalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
}

export const DEFAULT_DATE_FIELD_PALETTE: DateFieldPalette = {
  text: '#0E1A2B',
  muted: '#66768A',
  border: '#D5DEE6',
  surface: '#FFFFFF',
  accent: '#0B6A9E',
};

export interface DateFieldProps {
  // ISO 'YYYY-MM-DD', or undefined for an unset/cleared date. There is no
  // third "invalid" state — the platform picker (native OS dialog on
  // iOS/Android, <input type="date"> on web) physically cannot produce
  // anything else.
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  palette?: Partial<DateFieldPalette>;
  disabled?: boolean;
}
