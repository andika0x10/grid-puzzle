import { notFound } from "next/navigation";
import Game from "../../../components/Game";
import { getLevel } from "../../../game/provider";
export default async function PlayPage({ params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  if (!getLevel(levelId)) notFound();
  return <Game levelId={levelId} />;
}
