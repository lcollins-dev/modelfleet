import { describe, expect, it } from 'vitest';

import { BackendConfiguration, configuredValues } from '../../configuration';
import { IModelTensor } from '../../runtime';
import { llamaCppDeclaration } from './declaration';
import { IHostPlacement, hostPlacement } from './override-tensor';

const placementOf = (tensors: IModelTensor[] | null, configuration: BackendConfiguration): IHostPlacement =>
  hostPlacement(tensors, configuredValues(llamaCppDeclaration, configuration));

const hostTensorBytes = (tensors: IModelTensor[] | null, configuration: BackendConfiguration): number =>
  placementOf(tensors, configuration).tensors.reduce((total, tensor) => total + tensor.sizeBytes, 0);

const TENSORS: IModelTensor[] = [
  { name: 'output.weight', sizeBytes: 35_000 },
  { name: 'blk.0.attn_q.weight', sizeBytes: 1_000 },
  { name: 'blk.0.ffn_up_exps.weight', sizeBytes: 300 },
  { name: 'blk.1.ffn_up_exps.weight', sizeBytes: 200 },
];

const hostBytes = (...tensorOverrides: string[]): number => hostTensorBytes(TENSORS, { tensorOverrides });

describe('hostPlacement', () => {
  it('counts a tensor a pattern sends to the CPU', () => {
    expect(hostBytes('output.weight=CPU')).toBe(35_000);
  });

  it('matches a pattern anywhere in the name', () => {
    expect(hostBytes('ffn_.*_exps=CPU')).toBe(500);
  });

  it('reads every entry', () => {
    expect(hostBytes('output=CPU', 'blk\\.1\\.=CPU')).toBe(35_200);
  });

  it('reads comma-separated rules in one entry', () => {
    expect(hostBytes('output=CPU,blk\\.0\\.=CPU')).toBe(36_300);
  });

  it('counts nothing a pattern sends to another card', () => {
    expect(hostBytes('output=CUDA1')).toBe(0);
  });

  it('places a tensor by the first pattern matching it, as llama.cpp does', () => {
    expect(hostBytes('blk\\.0\\.=CUDA1', 'exps=CPU')).toBe(200);
  });

  it('counts nothing where no pattern matches', () => {
    expect(hostBytes('token_types\\.weight=CPU')).toBe(0);
  });

  it('counts nothing where the tensors are unknown', () => {
    expect(hostTensorBytes(null, { tensorOverrides: ['output=CPU'] })).toBe(0);
  });

  it('counts nothing where a pattern will not compile, whatever the others match', () => {
    expect(hostBytes('output=CPU', 'blk.(=CPU')).toBe(0);
  });

  it('counts nothing where an entry names no buffer', () => {
    expect(hostBytes('output=CPU,blk')).toBe(0);
  });

  it('counts every tensor where a pattern is empty, as llama.cpp matches it', () => {
    expect(hostBytes('=CPU')).toBe(36_500);
  });

  it('counts a tensor in every load mode, since host memory holds it whether mapped or read', () => {
    for (const loadMode of ['auto', 'mmap', 'none', 'dio', 'mlock', 'mmap+mlock']) {
      expect(hostTensorBytes(TENSORS, { tensorOverrides: ['output=CPU'], loadMode })).toBe(35_000);
    }
  });

  it('reads no override passed through the extra flags', () => {
    expect(hostTensorBytes(TENSORS, { extraFlags: ['--override-tensor output=CPU', '-ot blk=CPU'] })).toBe(0);
  });
});

describe('hostPlacement for lookup tables', () => {
  const TABLES: IModelTensor[] = [
    { name: 'per_layer_token_embd.weight', sizeBytes: 35_000 },
    { name: 'token_embd.weight', sizeBytes: 1_000 },
    { name: 'position_embd.weight', sizeBytes: 200 },
    { name: 'token_types.weight', sizeBytes: 100 },
    { name: 'output.weight', sizeBytes: 1_000 },
    { name: 'blk.0.attn_q.weight', sizeBytes: 50 },
  ];

  const hostNames = (configuration: BackendConfiguration, tensors: IModelTensor[] = TABLES): string[] =>
    placementOf(tensors, configuration).tensors.map(tensor => tensor.name);

  const withoutOutput = TABLES.filter(tensor => tensor.name !== 'output.weight');

  it('keeps every lookup table in host memory, as llama.cpp does with its input layer', () => {
    expect(hostNames({})).toEqual([
      'per_layer_token_embd.weight',
      'token_embd.weight',
      'position_embd.weight',
      'token_types.weight',
    ]);
  });

  it('keeps a lookup table in host memory where an override also sends it to the CPU', () => {
    expect(hostNames({ tensorOverrides: ['per_layer_token_embd.weight=CPU'] })).toContain(
      'per_layer_token_embd.weight'
    );
  });

  it('leaves a lookup table on the card an override sends it to', () => {
    expect(hostNames({ tensorOverrides: ['^token_embd=CUDA0'] })).not.toContain('token_embd.weight');
  });

  it('keeps nothing in host memory where an override will not parse, since llama.cpp then refuses to start', () => {
    expect(hostNames({ tensorOverrides: ['blk'] })).toEqual([]);
  });

  it('counts a copy of the token table on the cards where the model reads it as its output layer', () => {
    expect(placementOf(withoutOutput, {}).cardCopyBytes).toBe(1_000);
  });

  it('counts no copy where the model has an output layer of its own', () => {
    expect(placementOf(TABLES, {}).cardCopyBytes).toBe(0);
  });

  it('counts no copy where an override sends the token table to the CPU, since the copy then shares it', () => {
    expect(placementOf(withoutOutput, { tensorOverrides: ['^token_embd=CPU'] }).cardCopyBytes).toBe(0);
  });

  it('counts no copy where an override sends the token table to a card, since the copy then shares it', () => {
    expect(placementOf(withoutOutput, { tensorOverrides: ['^token_embd=CUDA0'] }).cardCopyBytes).toBe(0);
  });

  it('reads every lookup table only by row where the model has an output layer of its own', () => {
    expect(placementOf(TABLES, { tensorOverrides: ['^token_embd=CPU'] }).readByRow).toHaveLength(4);
  });

  it('reads the token table whole where an override sends the output layer copy to the CPU with it', () => {
    const readByRow = placementOf(withoutOutput, { tensorOverrides: ['^token_embd=CPU'] }).readByRow;

    expect(readByRow.map(tensor => tensor.name)).not.toContain('token_embd.weight');
  });

  it('reads the token table only by row where its output layer copy goes to the cards', () => {
    const readByRow = placementOf(withoutOutput, {}).readByRow;

    expect(readByRow.map(tensor => tensor.name)).toContain('token_embd.weight');
  });

  it('counts no copy where the token table is not listed', () => {
    const unlisted = withoutOutput.filter(tensor => tensor.name !== 'token_embd.weight');

    expect(placementOf(unlisted, {}).cardCopyBytes).toBe(0);
  });
});

describe('hostPlacement for experts', () => {
  const EXPERT_TENSORS: IModelTensor[] = [
    { name: 'blk.0.ffn_up_exps.weight', sizeBytes: 1 },
    { name: 'blk.0.ffn_down_exps.weight', sizeBytes: 2 },
    { name: 'blk.0.ffn_gate_exps.weight', sizeBytes: 4 },
    { name: 'blk.1.ffn_gate_up_exps.weight', sizeBytes: 8 },
    { name: 'blk.1.ffn_up_chexps.weight', sizeBytes: 16 },
    { name: 'blk.2.ffn_up_exps.weight', sizeBytes: 32 },
    { name: 'blk.10.ffn_up_exps.weight', sizeBytes: 64 },
    { name: 'blk.11.ffn_down_exps.weight', sizeBytes: 128 },
    { name: 'blk.0.ffn_gate_inp.weight', sizeBytes: 256 },
    { name: 'blk.0.ffn_up_shexp.weight', sizeBytes: 512 },
    { name: 'output.weight', sizeBytes: 1_024 },
  ];

  const expertBytes = (configuration: BackendConfiguration): number => hostTensorBytes(EXPERT_TENSORS, configuration);

  it('counts the expert tensors of the first layers cpuMoeLayers names', () => {
    expect(expertBytes({ cpuMoeLayers: 2 })).toBe(31);
  });

  it('counts no layer whose number only begins with a counted one', () => {
    expect(expertBytes({ cpuMoeLayers: 1 })).toBe(7);
  });

  it('counts nothing for no expert layers', () => {
    expect(expertBytes({ cpuMoeLayers: 0 })).toBe(0);
  });

  it('counts every layer where cpuMoeLayers passes the layer count', () => {
    expect(expertBytes({ cpuMoeLayers: 100 })).toBe(255);
  });

  it("counts every layer's expert tensors for cpuMoe", () => {
    expect(expertBytes({ cpuMoe: true })).toBe(255);
  });

  it('counts every layer at once, however many cpuMoeLayers names', () => {
    expect(expertBytes({ cpuMoeLayers: 2_000_000_000 })).toBe(255);
  });

  it('counts each expert once where cpuMoe and cpuMoeLayers both name it', () => {
    expect(expertBytes({ cpuMoe: true, cpuMoeLayers: 2 })).toBe(255);
  });

  it('counts nothing where cpuMoe is off', () => {
    expect(expertBytes({ cpuMoe: false })).toBe(0);
  });

  it('keeps an expert on the CPU that a later override sends to another card, as llama.cpp does', () => {
    expect(expertBytes({ cpuMoeLayers: 1, tensorOverrides: ['blk\\.0\\.ffn_up_exps=CUDA1'] })).toBe(7);
  });

  it('keeps every expert on the CPU under cpuMoe, whatever a later override names', () => {
    expect(expertBytes({ cpuMoe: true, tensorOverrides: ['exps=CUDA1'] })).toBe(255);
  });

  it('counts no experts where an override entry will not parse, since llama.cpp then refuses to start', () => {
    expect(expertBytes({ cpuMoe: true, tensorOverrides: ['blk'] })).toBe(0);
  });

  it('counts a tensor both the experts and an override send to the CPU once', () => {
    expect(expertBytes({ cpuMoeLayers: 1, tensorOverrides: ['blk\\.0\\.=CPU'] })).toBe(775);
  });

  it('counts nothing where the tensors are unknown', () => {
    expect(hostTensorBytes(null, { cpuMoe: true, cpuMoeLayers: 2 })).toBe(0);
  });

  it('reads no expert flag passed through the extra flags', () => {
    expect(expertBytes({ extraFlags: ['--cpu-moe', '--n-cpu-moe 2'] })).toBe(0);
  });
});
