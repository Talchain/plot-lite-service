export type DebugSliceName = 'compare' | 'inspector' | 'moi';

export function isDebugSliceEnabled(name: DebugSliceName, includeDebug?: boolean): boolean {
  if (!includeDebug) return false;
  
  switch (name) {
    case 'compare': return process.env.COMPARE_VIEW_ENABLE === '1';
    case 'inspector': return process.env.INSPECTOR_DEBUG_ENABLE === '1';
    case 'moi': return process.env.MOI_DEBUG_ENABLE === '1';
    default: return false;
  }
}
