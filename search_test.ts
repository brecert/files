import { assertEquals } from "https://deno.land/std@0.115.1/testing/asserts.ts";
import { parseSearch, TagType } from "./search.ts";

Deno.test("parseSearch smoketest", () => {
  const search =
    `+animal [~dog ~cat] [+fur.black +fur.white] -name:fido ~name:"bree bree"`;

  assertEquals(parseSearch(search), [
    { path: "animal", value: undefined, type: TagType.Require },
    {
      exprs: [
        { path: "dog", value: undefined, type: TagType.Include },
        { path: "cat", value: undefined, type: TagType.Include },
      ],
    },
    {
      exprs: [
        { path: "fur.black", value: undefined, type: TagType.Require },
        { path: "fur.white", value: undefined, type: TagType.Require },
      ],
    },
    { path: "name", value: "fido", type: TagType.Exclude },
    { path: "name", value: "bree bree", type: TagType.Include },
  ]);
});
