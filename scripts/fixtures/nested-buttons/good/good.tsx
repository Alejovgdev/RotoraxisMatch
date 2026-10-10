// Ejemplo para la autoprueba de scripts/checkNestedButtons.cjs. NO es código de
// la app: los patrones correctos, que la comprobación NO debe marcar.
import React from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';

function PillButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Text>{label}</Text>
    </Pressable>
  );
}

function ListRow({ trailing, onPress }: { trailing?: React.ReactNode; onPress?: () => void }) {
  const body = <View>{trailing}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  );
}

// Un contenedor que tiene botones pero no ES un botón (como BottomSheet).
function Sheet({ footer, children }: { footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => {}} />
      {children}
      {footer}
    </View>
  );
}

export function Good({ open }: { open: () => void }) {
  return (
    <View>
      {/* La fila: la zona principal es un pulsable y la acción, otro al lado. */}
      <View>
        <Pressable onPress={open} accessibilityRole="button">
          <Text>Technician</Text>
        </Pressable>
        <PillButton label="View profile" onPress={open} />
      </View>
      {/* Un touchable sin role="button" se pinta como <div>. */}
      <TouchableOpacity onPress={open}>
        <PillButton label="Inside a div" onPress={open} />
      </TouchableOpacity>
      {/* ListRow sin onPress no es un botón. */}
      <ListRow trailing={<PillButton label="Send" onPress={open} />} />
      <Sheet footer={<PillButton label="Done" onPress={open} />}>
        <PillButton label="Inside the sheet" onPress={open} />
      </Sheet>
      {/* Otros roles no son <button>. */}
      <Pressable onPress={open} accessibilityRole="link">
        <Text>A link</Text>
      </Pressable>
    </View>
  );
}
