import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera } from 'lucide-react-native';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';
import { Text } from './Text';
import { PillButton } from '../company/CompanyPage';
import { colors } from '../../theme';
import { changeProfileImage, squareImageCrop, type ProfileImageKind } from '../../usecases/profileImages';
import { profileImageRepository } from '../../repositories/v2/profileImageRepository';

/** Shared by You, Personal details and C-EditCompany. Saves only the image. */
export function ProfileImageEditor({ kind, id, name, path, size = 72, compact = false, disabled = false, onChanged }: {
  kind: ProfileImageKind; id: string; name: string; path?: string | null; size?: number;
  compact?: boolean; disabled?: boolean; onChanged?: (path: string | null) => void;
}) {
  const [current, setCurrent] = useState(path ?? null);
  const [visible, setVisible] = useState(false);
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [crop, setCrop] = useState({ zoom: 1, x: 0.5, y: 0.5 });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [cleanupPath, setCleanupPath] = useState<string | null>(null);
  const noun = kind === 'technician' ? 'photo' : 'logo';
  useEffect(() => { setCurrent(path ?? null); }, [path]);
  function close() { if (!busyRef.current) { setVisible(false); setAsset(null); setError(null); } }
  function open() { setError(null); setAsset(null); setVisible(true); }

  async function pick() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      // Called directly by a press: web requires the original user gesture.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'],
        allowsEditing: Platform.OS !== 'web', aspect: [1,1], quality: 1, allowsMultipleSelection: false });
      if (!result.canceled && result.assets[0]) {
        const selected = result.assets[0];
        squareImageCrop(selected.width, selected.height); // reject unusable dimensions
        setAsset(selected); setCrop({ zoom: 1, x: 0.5, y: 0.5 });
      }
    } catch { setError('Could not open this image. Check photo access or choose another image.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function save(remove = false) {
    if (busyRef.current || (!remove && !asset)) return;
    busyRef.current = true; setBusy(true); setError(null); setWarning(null);
    try {
      let prepared = null;
      if (!remove && asset) {
        const area = squareImageCrop(asset.width, asset.height, crop.zoom, crop.x, crop.y);
        const output = await manipulateAsync(asset.uri, [ { crop: area },
          { resize: { width: Math.min(512, area.width), height: Math.min(512, area.height) } } ],
          { format: kind === 'technician' ? SaveFormat.JPEG : SaveFormat.PNG, compress: 0.8, base64: true });
        if (!output.base64) throw new Error('Could not prepare the image.');
        const binary = atob(output.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
        prepared = { bytes: bytes.buffer, contentType: kind === 'technician' ? 'image/jpeg' as const : 'image/png' as const };
      }
      const result = await changeProfileImage(profileImageRepository, kind, id, current, prepared);
      setCurrent(result.path); setVisible(false); setAsset(null);
      if (result.cleanupPending) {
        setCleanupPath(current);
        setWarning(`Your ${noun} was saved, but the old file could not be deleted.`);
      }
      onChanged?.(result.path);
    } catch (e) { setError(e instanceof Error ? e.message : `Could not save your ${noun}.`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function retryCleanup() {
    if (!cleanupPath || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await profileImageRepository.remove(kind,cleanupPath); setCleanupPath(null); setWarning(null); }
    catch { setWarning('Could not delete the old file. Check your connection and retry.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const face = <Avatar kind={kind === 'company' ? 'company' : 'person'} size={size} name={name}
    photoPath={kind === 'technician' ? current : null} logoPath={kind === 'company' ? current : null} />;
  const area = asset ? squareImageCrop(asset.width, asset.height, crop.zoom, crop.x, crop.y) : null;
  const previewSize = 224;
  const scale = area ? previewSize / area.width : 1;
  function move(key: 'x' | 'y' | 'zoom', delta: number) {
    setCrop(value => ({ ...value, [key]: Math.max(key === 'zoom' ? 1 : 0, Math.min(key === 'zoom' ? 3 : 1, value[key] + delta)) }));
  }
  return <View style={compact ? undefined : styles.wrapper}>
    <View style={styles.row}>
      {compact ? <Pressable onPress={open} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={`Change ${noun}`}>
        {face}<View style={styles.camera}><Camera size={15} color={colors.white} /></View>
      </Pressable> : <>{face}<PillButton label={`Change ${noun}`} variant="outline" onPress={open} disabled={disabled || busy} /></>}
    </View>
    {warning ? <Text style={styles.note} accessibilityRole="alert">{warning}</Text> : null}
    {cleanupPath ? <PillButton label="Retry cleanup" variant="outline" onPress={() => void retryCleanup()} disabled={busy} /> : null}
    <BottomSheet visible={visible} onClose={close} dismissible={!busy} title={`Change ${noun}`}>
      {asset && area ? <>
        <View style={styles.preview} accessibilityLabel="Square image preview">
          <Image source={{ uri: asset.uri }} style={{ position: 'absolute', width: asset.width*scale, height: asset.height*scale,
            left: -area.originX*scale, top: -area.originY*scale }} />
        </View>
        {Platform.OS === 'web' ? <>
          <Text style={styles.note}>Adjust the square crop before saving.</Text>
          <View style={styles.controls}>
            <CropButton label="Move crop left" text="←" onPress={() => move('x',-0.1)} disabled={busy || crop.x<=0} />
            <CropButton label="Move crop right" text="→" onPress={() => move('x',0.1)} disabled={busy || crop.x>=1} />
            <CropButton label="Move crop up" text="↑" onPress={() => move('y',-0.1)} disabled={busy || crop.y<=0} />
            <CropButton label="Move crop down" text="↓" onPress={() => move('y',0.1)} disabled={busy || crop.y>=1} />
            <CropButton label="Zoom out" text="−" onPress={() => move('zoom',-0.25)} disabled={busy || crop.zoom<=1} />
            <CropButton label="Zoom in" text="+" onPress={() => move('zoom',0.25)} disabled={busy || crop.zoom>=3} />
          </View>
        </> : null}
        <PillButton label={busy ? 'Saving…' : `Save ${noun}`} onPress={() => void save()} disabled={busy} />
      </> : null}
      <PillButton label={asset ? 'Choose another image' : 'Choose image'} variant="outline" onPress={() => void pick()} disabled={busy} />
      {current && !asset ? <PillButton label={`Remove ${noun}`} variant="outline" onPress={() => void save(true)} disabled={busy} /> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <PillButton label="Cancel" variant="outline" onPress={close} disabled={busy} />
    </BottomSheet>
  </View>;
}
function CropButton({label,text,onPress,disabled}:{label:string;text:string;onPress:()=>void;disabled:boolean}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{disabled}} style={[styles.cropButton,disabled && {opacity:0.4}]}><Text style={styles.arrow}>{text}</Text></Pressable>;
}
const styles = StyleSheet.create({
  wrapper: {gap:8}, row:{flexDirection:'row',alignItems:'center',gap:14},
  camera:{position:'absolute',right:-4,bottom:-4,width:30,height:30,borderRadius:15,borderWidth:2,borderColor:colors.white,
    backgroundColor:colors.text,alignItems:'center',justifyContent:'center'},
  preview:{width:224,height:224,alignSelf:'center',overflow:'hidden',backgroundColor:colors.surfaceMuted,borderRadius:12},
  controls:{flexDirection:'row',flexWrap:'wrap',gap:8,justifyContent:'center'},
  cropButton:{minWidth:44,minHeight:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:colors.surfaceMuted},
  arrow:{fontSize:22,color:colors.text}, note:{fontSize:13,color:colors.textSecondary}, error:{fontSize:14,color:colors.error},
});
