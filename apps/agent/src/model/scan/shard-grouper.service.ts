import { Injectable } from '@nestjs/common';
import { basename, dirname, join } from 'node:path';

import { IModelFile } from './types/model-file';

export interface INumberedSet {
  /** In shard order. */
  files: readonly IModelFile[];
  sizeBytes: number;
  name: string;
}

export interface INumberedGap {
  base: string;

  /** Names no file: the base, joined to the directory of the members present. */
  path: string;

  expected: number;
  missing: readonly number[];
}

export interface INumberedGrouping {
  sets: INumberedSet[];
  gaps: INumberedGap[];
}

export interface IShardName {
  base: string;
  /** Counts from 1, as the names do. */
  index: number;
  total: number;
}

interface IPartialSet {
  base: string;
  total: number;
  members: Map<number, IModelFile>;
}

@Injectable()
export class ShardGrouperService {
  /**
   * Reads `<base>-00002-of-00005<suffix>`, the convention llama.cpp and Hugging Face share. A file
   * named otherwise is a set of one. Pass one directory's files: a set spans no two.
   */
  group(files: readonly IModelFile[], suffix: string): INumberedGrouping {
    const sets: INumberedSet[] = [];
    const gaps: INumberedGap[] = [];
    const partials = new Map<string, IPartialSet>();

    for (const file of files) {
      const shardName = this.parseName(basename(file.path), suffix);

      if (shardName === null) {
        sets.push(this.loneSet(file, suffix));

        continue;
      }

      const { base, index, total } = shardName;
      const key = `${base} ${String(total)}`;
      const partial = partials.get(key) ?? { base, total, members: new Map<number, IModelFile>() };

      partial.members.set(index, file);
      partials.set(key, partial);
    }

    for (const partial of partials.values()) {
      const result = this.completeSet(partial);

      if ('files' in result) {
        sets.push(result);
      } else {
        gaps.push(result);
      }
    }

    return { sets, gaps };
  }

  /** Null where the name carries no numbering, or numbering no set could have. The suffix matches in any case. */
  parseName(name: string, suffix: string): IShardName | null {
    const match = this.patternFor(suffix).exec(name);

    if (match?.groups === undefined) {
      return null;
    }

    const index = Number(match.groups.index);
    const total = Number(match.groups.total);

    if (total < 1 || index < 1 || index > total) {
      return null;
    }

    return { base: match.groups.base, index, total };
  }

  gapMessage(gap: INumberedGap): string {
    return `${gap.base} is missing shard ${gap.missing.join(', ')} of ${String(gap.expected)}, so it is not reported`;
  }

  /** Lowercase throughout, as llama.cpp derives a set's members from its first shard's name. */
  memberName(shardName: IShardName, suffix: string): string {
    return `${shardName.base}-${this.pad(shardName.index)}-of-${this.pad(shardName.total)}${suffix}`;
  }

  /** Keeps the name's own case, since `parseName` matches any. A name without numbering comes back unchanged. */
  siblingName(name: string, suffix: string, index: number): string {
    return name.replace(this.patternFor(suffix), `$<base>-${this.pad(index)}$<rest>`);
  }

  private patternFor(suffix: string): RegExp {
    return new RegExp(`^(?<base>.+)-(?<index>\\d{5})(?<rest>-of-(?<total>\\d{5})${suffix.replace('.', '\\.')})$`, 'i');
  }

  private pad(value: number): string {
    return String(value).padStart(5, '0');
  }

  private stemOf(path: string, suffix: string): string {
    const name = basename(path);

    return name.toLowerCase().endsWith(suffix) ? name.slice(0, name.length - suffix.length) : name;
  }

  private loneSet(file: IModelFile, suffix: string): INumberedSet {
    return { files: [file], sizeBytes: file.sizeBytes, name: this.stemOf(file.path, suffix) };
  }

  private completeSet(partial: IPartialSet): INumberedSet | INumberedGap {
    const missing: number[] = [];
    const files: IModelFile[] = [];

    for (let index = 1; index <= partial.total; index += 1) {
      const member = partial.members.get(index);

      if (member === undefined) {
        missing.push(index);
      } else {
        files.push(member);
      }
    }

    if (missing.length > 0) {
      const directory = dirname(files[0].path);

      return { base: partial.base, path: join(directory, partial.base), expected: partial.total, missing };
    }

    return { files, sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), name: partial.base };
  }
}
