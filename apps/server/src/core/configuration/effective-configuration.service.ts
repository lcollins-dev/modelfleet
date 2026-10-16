import { Injectable } from '@nestjs/common';

import { BackendId, backendField, BackendField, BackendFieldType, BackendDeclaration } from '@libs/backends';
import { ConfigurationDocument, ConfigurationSource, ConfigurationValue } from '@libs/dto';

import { ConfigurationValueService } from './configuration-value.service';

import { FLEET_FIELDS } from './schema/fleet';

export interface IEffectiveConfigurationEntry {
  key: string;
  value: ConfigurationValue;
  source: ConfigurationSource;

  presetValue?: ConfigurationValue;

  modelled: boolean;
}

export interface IEffectiveConfiguration {
  backend: BackendId;

  /** Fleet keys first, then the backend's declared fields in declaration order, then unmodelled keys by name. */
  entries: IEffectiveConfigurationEntry[];

  /** Declared defaults are excluded, so nothing downstream resolves a default twice. */
  configuration: ConfigurationDocument;
}

@Injectable()
export class EffectiveConfigurationService {
  constructor(private readonly configurationValueService: ConfigurationValueService) {}

  /**
   * A key present in the overrides replaces the preset's value whole; a key absent inherits, so `null` stays
   * usable as a value. Pass an empty preset document for a deployment naming no preset.
   */
  resolve(
    backend: BackendId,
    declaration: BackendDeclaration,
    preset: ConfigurationDocument,
    overrides: ConfigurationDocument
  ): IEffectiveConfiguration {
    const documentKeys = [...Object.keys(preset), ...Object.keys(overrides)];
    const keys = this.orderKeys(declaration, [...documentKeys, ...this.declaredKeys(declaration, documentKeys)]);
    const entries = keys.map(key => this.entryFor(declaration, key, preset, overrides));

    const document = entries.filter(entry => entry.source !== ConfigurationSource.DECLARATION);

    return {
      backend,
      entries,
      configuration: Object.fromEntries(document.map(entry => [entry.key, entry.value])),
    };
  }

  /** The override keys `from` models and `to` does not. A key neither models is an escape hatch and stays. */
  orphanedKeys(from: BackendDeclaration, to: BackendDeclaration, overrides: ConfigurationDocument): string[] {
    return Object.keys(overrides).filter(key => this.isModelled(from, key) && !this.isModelled(to, key));
  }

  /**
   * Every key whose value differs, keys added and keys removed included, ordered by name. `jsonb` reads a stored
   * document back in its own key order, so authored order is not available to keep.
   */
  changedKeys(before: ConfigurationDocument, after: ConfigurationDocument): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    return [...keys].filter(key => !this.configurationValueService.isEqual(before[key], after[key])).sort();
  }

  /** The fields no document sets that carry a default, which an instance is launched with all the same. */
  private declaredKeys(declaration: BackendDeclaration, documentKeys: string[]): string[] {
    const held = new Set(documentKeys);

    return declaration.fields
      .filter(field => field.default !== undefined && !held.has(field.name))
      .filter(field => !this.passesNothing(field))
      .map(field => field.name);
  }

  /** A boolean passes its flag only when true, so one defaulting to false with no off flag reaches the backend as
   * nothing. */
  private passesNothing(field: BackendField): boolean {
    return field.type === BackendFieldType.BOOLEAN && field.default === false && field.offFlag === undefined;
  }

  private entryFor(
    declaration: BackendDeclaration,
    key: string,
    preset: ConfigurationDocument,
    overrides: ConfigurationDocument
  ): IEffectiveConfigurationEntry {
    const overridden = Object.hasOwn(overrides, key);
    const inherited = Object.hasOwn(preset, key);

    if (!overridden && !inherited) {
      return this.declaredEntry(declaration, key);
    }

    const entry: IEffectiveConfigurationEntry = {
      key,
      value: overridden ? overrides[key] : preset[key],
      source: overridden ? ConfigurationSource.DEPLOYMENT : ConfigurationSource.PRESET,
      modelled: this.isModelled(declaration, key),
    };

    if (overridden && inherited) {
      entry.presetValue = preset[key];
    }

    return entry;
  }

  private declaredEntry(declaration: BackendDeclaration, key: string): IEffectiveConfigurationEntry {
    return {
      key,
      value: this.declaredDefault(backendField(declaration, key)),
      source: ConfigurationSource.DECLARATION,
      modelled: true,
    };
  }

  /** A declared default is read only, so a list is copied into the document's own list type. */
  private declaredDefault(field: BackendField | undefined): ConfigurationValue {
    const value = field?.default;

    if (value === undefined) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    return [...value];
  }

  private orderKeys(declaration: BackendDeclaration, keys: string[]): string[] {
    const present = new Set(keys);

    const fleet = FLEET_FIELDS.filter(key => present.has(key));
    const declared = declaration.fields.map(field => field.name).filter(key => present.has(key));

    const ordered = new Set([...fleet, ...declared]);
    const unmodelled = [...present].filter(key => !ordered.has(key)).sort();

    return [...fleet, ...declared, ...unmodelled];
  }

  private isModelled(declaration: BackendDeclaration, key: string): boolean {
    return FLEET_FIELDS.includes(key) || backendField(declaration, key) !== undefined;
  }
}
