/**
 * Node effect transforms (linear, threshold, piecewise_linear)
 */

export interface EffectLinear {
  kind: 'linear';
}

export interface EffectThreshold {
  kind: 'threshold';
  params: {
    threshold: number;
    low: number;
    high: number;
  };
}

export interface EffectPiecewiseLinear {
  kind: 'piecewise_linear';
  params: {
    breakpoints: Array<{ x: number; y: number }>;
  };
}

export type NodeEffect = EffectLinear | EffectThreshold | EffectPiecewiseLinear;

/**
 * Apply effect transform to a value
 */
export function applyEffect(value: number, effect?: NodeEffect): number {
  if (!effect || effect.kind === 'linear') {
    return value; // Default: identity
  }
  
  if (effect.kind === 'threshold') {
    const { threshold, low, high } = effect.params;
    return value < threshold ? low : high;
  }
  
  if (effect.kind === 'piecewise_linear') {
    const { breakpoints } = effect.params;
    
    // Sort breakpoints by x
    const sorted = [...breakpoints].sort((a, b) => a.x - b.x);
    
    // Find segment
    if (value <= sorted[0].x) return sorted[0].y;
    if (value >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    
    // Linear interpolation between breakpoints
    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      
      if (value >= p1.x && value <= p2.x) {
        const t = (value - p1.x) / (p2.x - p1.x);
        return p1.y + t * (p2.y - p1.y);
      }
    }
    
    return value; // Fallback
  }
  
  return value;
}

/**
 * Validate effect configuration
 */
export function validateEffect(effect: any): { valid: boolean; error?: string } {
  if (!effect) return { valid: true };
  
  if (!effect.kind) {
    return { valid: false, error: 'effect.kind required' };
  }
  
  if (effect.kind === 'linear') {
    return { valid: true };
  }
  
  if (effect.kind === 'threshold') {
    if (!effect.params) {
      return { valid: false, error: 'threshold effect requires params' };
    }
    
    const { threshold, low, high } = effect.params;
    
    if (typeof threshold !== 'number' || typeof low !== 'number' || typeof high !== 'number') {
      return { valid: false, error: 'threshold params must be numbers' };
    }
    
    if (!isFinite(threshold) || !isFinite(low) || !isFinite(high)) {
      return { valid: false, error: 'threshold params must be finite' };
    }
    
    return { valid: true };
  }
  
  if (effect.kind === 'piecewise_linear') {
    if (!effect.params || !Array.isArray(effect.params.breakpoints)) {
      return { valid: false, error: 'piecewise_linear requires breakpoints array' };
    }
    
    const { breakpoints } = effect.params;
    
    if (breakpoints.length < 2) {
      return { valid: false, error: 'piecewise_linear requires at least 2 breakpoints' };
    }
    
    for (const bp of breakpoints) {
      if (typeof bp.x !== 'number' || typeof bp.y !== 'number') {
        return { valid: false, error: 'breakpoints must have numeric x and y' };
      }
      
      if (!isFinite(bp.x) || !isFinite(bp.y)) {
        return { valid: false, error: 'breakpoint values must be finite' };
      }
    }
    
    return { valid: true };
  }
  
  return { valid: false, error: `unknown effect kind: ${effect.kind}` };
}
