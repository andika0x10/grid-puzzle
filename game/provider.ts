import catalog from "../content/catalog.json";
import { levelSchema, sectionSchema, type LevelDefinition, type SectionDefinition } from "./schema";
export const sections: SectionDefinition[] = catalog.sections.map((s) => sectionSchema.parse(s)).sort((a, b) => a.order - b.order);
export const levels: LevelDefinition[] = catalog.levels.map((l) => levelSchema.parse(l));
export const getLevel = (id: string) => levels.find((l) => l.id === id);
