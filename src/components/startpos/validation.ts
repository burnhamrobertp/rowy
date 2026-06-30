import { StartPos } from "./types";

// Mirrors the checks in maps-metadata scripts/js/src/check_startpos.ts so map
// makers see the same errors here rather than at metadata-generation time.
export function validateStartPos(sp: StartPos): string[] {
  const errors: string[] = [];
  const positionNames = new Set(Object.keys(sp.positions));
  const seenConfs = new Set<string>();

  (sp.team || []).forEach((team, ti) => {
    const label = `Team config ${ti + 1} (${team.teamCount} teams, ${
      team.playersPerTeam
    } players)`;

    const confKey = `${team.teamCount}|${team.playersPerTeam}`;
    if (seenConfs.has(confKey)) {
      errors.push(
        `Duplicate config for ${team.teamCount} teams with ${team.playersPerTeam} players`
      );
    }
    seenConfs.add(confKey);

    if (team.teamCount !== team.sides.length) {
      errors.push(
        `${label}: has ${team.sides.length} sides but teamCount is ${team.teamCount}`
      );
    }

    team.sides.forEach((side, si) => {
      if (team.playersPerTeam !== side.starts.length) {
        errors.push(
          `${label}: side ${si + 1} has ${
            side.starts.length
          } starts but playersPerTeam is ${team.playersPerTeam}`
        );
      }
      side.starts.forEach((start, sti) => {
        const where = `${label}: side ${si + 1} start ${sti + 1}`;
        if (!start.spawnPoint) {
          errors.push(`${where} has no spawn point`);
        } else if (!positionNames.has(start.spawnPoint)) {
          errors.push(
            `${where} uses unknown spawn point "${start.spawnPoint}"`
          );
        }
        if (start.baseCenter && !positionNames.has(start.baseCenter)) {
          errors.push(
            `${where} uses unknown base center "${start.baseCenter}"`
          );
        }
      });
    });
  });

  return errors;
}
