import { designCampaign } from "./campaign-design";
import { gameModes } from "../game/schema";
import { themeIds } from "../game/themes";
import { modeInfo } from "../game/modes";
export const authorLevels = designCampaign;
export const sections = gameModes.map((id, i) => ({
  id,
  order: i + 1,
  title: modeInfo[id].title,
  subtitle: modeInfo[id].help.split(".")[0] + ".",
  levelIds: themeIds.map((_, j) => `${id}-${j + 1}`),
}));
