// Ejemplo para la autoprueba de scripts/checkNestedButtons.cjs. NO es código de
// la app: contiene a propósito SEIS botones dentro de otro botón, y la
// comprobación tiene que encontrar los seis.
import React from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';

function PillButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Text>{label}</Text>
    </Pressable>
  );
}

function Row({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {children}
    </Pressable>
  );
}

function ListRow({ trailing, onPress }: { trailing?: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {trailing}
    </Pressable>
  );
}

export function Bad({ wide, open }: { wide: boolean; open: () => void }) {
  // 3: botones en una constante usada dentro de una condición.
  const actions = <PillButton label="Open chat" onPress={open} />;
  return (
    <View>
      {/* 1: componente botón directamente dentro. */}
      <Pressable onPress={open} accessibilityRole="button">
        <PillButton label="View profile" onPress={open} />
      </Pressable>
      {/* 2: touchable con role button dentro de otro. */}
      <TouchableOpacity onPress={open} accessibilityRole="button">
        <Pressable onPress={open} role="button"><Text>x</Text></Pressable>
      </TouchableOpacity>
      <Pressable onPress={open} accessibilityRole="button">
        {!wide ? actions : null}
      </Pressable>
      {/* 4: dentro de un componente cuya raíz es un botón (Row). */}
      <Row onPress={open}>
        <PillButton label="Review" onPress={open} />
      </Row>
      {/* 5: en un prop de un componente botón (ListRow con onPress). */}
      <ListRow onPress={open} trailing={<PillButton label="Send" onPress={open} />} />
      {/* 6: dentro de una render prop. */}
      <Pressable onPress={open} accessibilityRole="button">
        {() => <PillButton label="Inner" onPress={open} />}
      </Pressable>
    </View>
  );
}
