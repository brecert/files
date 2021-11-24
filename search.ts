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

  return exprs;
}