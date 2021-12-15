import { filterEntries } from "https://deno.land/std@0.114.0/collections/mod.ts";

import { ActionParams, ID } from "./common.ts";

import { generateFileDiff, parseConfigTag } from "./utils.ts";
import { ILockfile, Lockfile } from "./lockfile.ts";
import { ILinkfile, Linkfile } from "./linkfile.ts";

import * as search from "../search.ts";

//! Config

export type ConfigTag = string | Record<string, string>;

export interface FileInfo {
  source: string;
  tags?: ConfigTag[];
}

export interface IConfig {
  files: Record<ID, FileInfo>;
}

type EditParams = ActionParams & {
  lockfile?: ILockfile;
  linkfile?: ILinkfile;
  at: string;
};

export class Config implements IConfig {
  files: IConfig["files"];

  static default() {
    return new this({ files: {} });
  }

  static from = (config: Partial<IConfig>) => {
    return new this({ ...this.default(), ...config });
  };

  constructor(config: IConfig) {
    this.files = config.files;
  }

  async edit(
    edits: (config: Readonly<this>) => Readonly<IConfig>,
    {
      lockfile: prevLockfile = { file_locks: {} },
      linkfile: prevLinkfile,
      ...params
    }: EditParams,
  ) {
    const edited = edits(this);

    const lockfile = await Lockfile.from(edited, {
      ...params,
      prev: prevLockfile,
    });

    const linkfile = Linkfile.from(lockfile);

    return {
      config: edited,
      lockfile: lockfile,
      linkfile: linkfile,
      diff() {
        return generateFileDiff(linkfile, {
          prev: prevLinkfile ?? Linkfile.from(prevLockfile),
        });
      },
    };
  }

  // todo: change the way querying works to be more like jq or a small (and very simple) language? even regex might be enough
  // alternatively, I could make it as simple as possible and only have a command to output all the files and jq that externally or something
  search(query: search.Expr[]) {
    return filterEntries(this.files, ([_id, file]) => {
      const tagList = file.tags?.flatMap(parseConfigTag) ?? [];
      return search.isMatch(search.match(tagList, query));
    });
  }

  toObject(): IConfig {
    return this;
  }
}
