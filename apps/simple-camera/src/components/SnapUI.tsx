import { useNavigation } from '@react-navigation/native'
import type { PropsWithChildren } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { text, useSettings } from '../services/snapport'

export const palette = {
  bg: '#101317',
  surface: '#1D232B',
  ink: '#F3F5F7',
  muted: '#ACB5C2',
  accent: '#9CDFC2',
  error: '#FFB4A8',
}
export function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.65 },
      ]}
    >
      <Text style={ui.buttonText}>{label}</Text>
    </Pressable>
  )
}
export function Page({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  useSettings()
  return (
    <View
      style={[
        ui.page,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={ui.header}>
        <Action
          label={text('返回', 'Back')}
          onPress={() => navigation.goBack()}
        />
        <Text style={ui.title}>{title}</Text>
      </View>
      <ScrollView
        contentContainerStyle={ui.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  )
}
export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  title: { color: palette.ink, fontSize: 24, fontWeight: '600', flexShrink: 1 },
  content: { padding: 20, gap: 16 },
  section: {
    backgroundColor: palette.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  text: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  note: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  error: { color: palette.error, fontSize: 14, lineHeight: 21 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#495664',
  },
  buttonText: { color: palette.accent, fontSize: 15, fontWeight: '600' },
  input: {
    color: palette.ink,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: '#495664',
    borderRadius: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 16,
  },
})
