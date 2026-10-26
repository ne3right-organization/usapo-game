import { defineFunction } from "@aws-amplify/backend";

// upsertZukanComment と deleteZukanComment の両方を受ける
export const zukanComment = defineFunction({
  name: "zukan-comment",
  resourceGroupName: "data",
});
