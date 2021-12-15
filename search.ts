import {
  groupBy,
  partition,
} from "https://deno.land/std@0.117.0/collections/mod.ts";

import * as common from "./formats/common.ts";

const SEARCH =
  /((?:\[(?<group>.+?)\])|(?:(?<prefix>[+~-])(?<path>\w+(?:\.\w+)*)(?::(?<value1>\w+)|:"(?<value2>.+?)")?))/g;

export class ParsingError extends Error {}

export enum TagType {
  Require = "require",
  Include = "include",
  Exclude = "exclude",
}

const TAG_TYPE = {
  "+": TagType.Require,
  "~": TagType.Include,
  "-": TagType.Exclude,
};

export const SearchType = Symbol("search type");

export type Tag = {
  type: TagType;
  path: string;
  value?: string;
};

export type Group = {
  exprs: Expr[];
};

export type Expr = Tag | Group;

export function parseSearch(str: string) {
  let lastPos = 0;
  const exprs: Expr[] = [];
  for (const match of str.matchAll(SEARCH)) {
    const pos = match.index;
    const notWhitespace = /[^\s]/;

    if (notWhitespace.test(str.slice(lastPos, pos))) {
      throw new ParsingError(
        `Unexpected token at ${lastPos + notWhitespace.lastIndex}`,
      );
    }

    const groups = match.groups!;

    if (groups.path) {
      const type = TAG_TYPE[groups.prefix as keyof typeof TAG_TYPE];
      const value = groups.value1 ?? groups.value2;
      const path = groups.path;
      exprs.push({ type, value, path });
    } else {
      try {
        exprs.push({ exprs: parseSearch(groups.group) });
      } catch (err) {
        if (err instanceof ParsingError) {
          throw new ParsingError(`Error while parsing in group at ${pos}`, {
            cause: err,
          });
        }
        throw err;
      }
    }

    lastPos = match.index! + match[0].length;
  }

  // todo: this could be better integrated into the rest of the function
  if (exprs.length === 0 && str.trim().length > 0) {
    const nextTok = str.search(/[^\s]/);
    throw new ParsingError(`Unexpected token at ${nextTok}`);
  }

  return exprs;
}

export type Match = {
  require?: boolean;
  include?: boolean;
  exclude?: boolean;
  groups: Match[];
};

/**
 * Match tags with a parsed tag expression, returning with what succeeded and failed.
 * @returns an object with lazy getters for each tag & group type returning what succeeded and failed.
 */
export function match(
  matchTags: common.Tag[],
  exprs: Expr[],
): Match {
  const [ungroupedTags, groups] = partition(
    exprs,
    (expr) => "type" in expr,
  ) as [Tag[], Group[]];
  const tags = groupBy(ungroupedTags, (t) => t.type) as Partial<
    Record<
      "require" | "include" | "exclude",
      Tag[]
    >
  >;

  const matchesTag = (t: Tag) =>
    matchTags.some((tag) =>
      t.value != null
        ? tag.path === t.path && tag.value === t.value
        : tag.path.startsWith(t.path)
    );

  // lazy for performance
  return {
    get require() {
      return tags.require?.every(matchesTag);
    },
    get include() {
      return tags.include?.some(matchesTag);
    },
    get exclude() {
      return tags.exclude ? !tags.exclude.some(matchesTag) : undefined;
    },
    get groups() {
      return groups.map((group) => match(matchTags, group.exprs));
    },
  };
}

// todo: better clarify the distinction between a match and a valid match
/**
 * Determines if a match result is a valid match
 */
export function isMatch(match: Match, isGroup = false): boolean {
  if (!isGroup) {
    return [
      match.require,
      match.include,
      match.exclude,
      match.groups.every((group) => isMatch(group, true)),
    ].filter((m) => m != null).every((m) => m);
  } else {
    return (
      match.include ||
      match.exclude ||
      match.require ||
      match.groups.some((group) => isMatch(group, true))
    );
  }
}
