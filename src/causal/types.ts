export type VarId = string;

export type DAG = {
  nodes: VarId[];
  edges: Array<[VarId, VarId]>; // [from, to]
};

export type StructuralEquation = (
  parents: Record<VarId, number>,
  u: Record<VarId, number>
) => number;

export type SCM = {
  dag: DAG;
  f: Record<VarId, StructuralEquation>;
  U: Record<VarId, { dist: 'normal' | 'uniform'; params: any }>;
};

export type Intervention = { do: Partial<Record<VarId, number>> };

export type Query = {
  outcome: VarId;
  given?: Record<VarId, number>;
  intervention?: Intervention;
};
