import axios, { AxiosResponse } from "axios";
import {
  GameData,
  SideData,
  LadderStats,
  Member,
  TeamSide,
  MapStatCache,
  Factions,
} from "../../redux/state";
import { LogFileGameData, LogFilePlayerData, LogFileTeamData } from "./parseLogFile";
import {
  LeaderboardStat,
  PersonalStatResponse,
  StatGroup,
  StatGroupMember,
} from "@coh2stats/shared/src/coh/coh2-api";

const leaderboardIDLookupTable = {
  german: [4, 8, 12, 16],
  soviet: [5, 9, 13, 17],
  west_german: [6, 10, 14, 18],
  aef: [7, 11, 15, 19],
  axis: [20, 22, 24],
  allies: [21, 23, 25],
  british: [51, 52, 53, 54],
};

const teamLeaderboardIdsLookupTable: Record<TeamSide, number[]> = {
  axis: [20, 22, 24],
  allies: [21, 23, 25],
  mixed: [],
};

/**
 * Uses data from the relic api refine and extend the data found in the warnings.log file
 * @param logFileGameData Game data from reading the warnings.log file
 * @returns Promise with refined game data using the relic api if relic request was successful
 */
export const refineLogFileData = (
  logFileGameData: LogFileGameData,
  uniqueId: string,
  mapStatCache?: MapStatCache,
): Promise<GameData> => {
  return new Promise((resolve, reject) => {
    fetchDataFromRelicAPI(logFileGameData).then(
      (response: AxiosResponse<PersonalStatResponse>) => {
        const apiData = response.data;
        if (response.status === 200 && apiData.result.code === 0) {
          const initialGameData: GameData = {
            found: true,
            uniqueId: uniqueId,
            state: logFileGameData.state,
            type: logFileGameData.type,
            map: logFileGameData.map,
            winCondition: logFileGameData.winCondition,
            left: parseSideData(logFileGameData.left, apiData),
            right: parseSideData(logFileGameData.right, apiData),
            mapWinRatioLeft: undefined,
            winProbabilityLeft: undefined,
          };
          addBalanceStats(initialGameData, mapStatCache);
          /*if (mapStatCache) {
            const mapData = findMapInApiData(mapStatCache.data, initialGameData);
            // found map?
            if (mapData) {
              const factionMatrix = getFactionMatrix(initialGameData);
              const winLosses = mapData["factionMatrix"][factionMatrix];
              if (winLosses) {
                const totalMapCompositionDataPoints = winLosses.wins + winLosses.losses;
                if (totalMapCompositionDataPoints > 5) {
                  const axisMapWinRatio = (winLosses.wins / totalMapCompositionDataPoints) * 100;
                  const alliesMapWinRatio =
                    (winLosses.losses / totalMapCompositionDataPoints) * 100;
                  initialGameData.mapWinRatioLeft = initialGameData.left.side === "axis" ? axisMapWinRatio : alliesMapWinRatio;
                  if (initialGameData.left.averageLevel && initialGameData.left.averageWinRatio && initialGameData.right.averageLevel && initialGameData.right.averageWinRatio) {
                    const leftStrength = initialGameData.left.averageLevel * initialGameData.left.averageWinRatio;
                    const rightStrength = initialGameData.right.averageLevel * initialGameData.right.averageWinRatio;
                    const leftStrengthRatio = (leftStrength / (leftStrength + rightStrength)) * 100;
                    initialGameData.winProbabilityLeft = (leftStrengthRatio + initialGameData.mapWinRatioLeft) / 2;
                  }
                }
              }
            }
          }*/
          resolve(addBalanceStats(initialGameData, mapStatCache));
        } else {
          reject();
        }
      },
      (reason) => {
        reject(reason);
      },
    );
  });
};

const addBalanceStats = (game: GameData, mapStatCache?: MapStatCache): GameData => {
  if (mapStatCache) {
    const mapData = findMapInApiData(mapStatCache.data, game);
    // found map?
    if (mapData) {
      const factionMatrix = getFactionMatrix(game);
      const winLosses = mapData["factionMatrix"][factionMatrix];
      if (winLosses) {
        const totalMapCompositionDataPoints = winLosses.wins + winLosses.losses;
        if (totalMapCompositionDataPoints > 5) {
          const axisMapWinRatio = (winLosses.wins / totalMapCompositionDataPoints) * 100;
          const alliesMapWinRatio = (winLosses.losses / totalMapCompositionDataPoints) * 100;
          game.mapWinRatioLeft = game.left.side === "axis" ? axisMapWinRatio : alliesMapWinRatio;
          if (
            game.left.averageLevel &&
            game.left.averageWinRatio &&
            game.right.averageLevel &&
            game.right.averageWinRatio
          ) {
            const leftStrength = game.left.averageLevel * game.left.averageWinRatio;
            const rightStrength = game.right.averageLevel * game.right.averageWinRatio;
            const leftStrengthRatio = (leftStrength / (leftStrength + rightStrength)) * 100;
            game.winProbabilityLeft = (leftStrengthRatio + game.mapWinRatioLeft) / 2;
          }
        }
      }
    }
  }
  return game;
};

const factionLetterLookupTable: Record<Factions, string> = {
  german: "O",
  west_german: "W",
  british: "B",
  soviet: "S",
  aef: "U",
};

const getFactionMatrix = (gameData: GameData): string => {
  let axis = gameData.left;
  let allies = gameData.right;
  if (gameData.left.side === "allies") {
    axis = gameData.right;
    allies = gameData.left;
  }
  let factionMatrixString = "";
  factionMatrixString += axis.solo
    .map((stats) => factionLetterLookupTable[stats.members[0].faction])
    .sort((a, b) => a.localeCompare(b))
    .join("");
  factionMatrixString += "x";
  factionMatrixString += allies.solo
    .map((stats) => factionLetterLookupTable[stats.members[0].faction])
    .sort((a, b) => a.localeCompare(b))
    .join("");
  return factionMatrixString;
};

const getBiggestTeamSize = (gameData: GameData) => {
  if (gameData.left.solo.length > gameData.right.solo.length) {
    return gameData.left.solo.length;
  }
  return gameData.right.solo.length;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const findMapInApiData = (apiData: any, gameData: GameData): any | undefined => {
  const minMapSize = getBiggestTeamSize(gameData);
  for (let i = minMapSize; i <= 4; i++) {
    const mapCategory = i + "v" + i;
    if (mapCategory in apiData) {
      for (const [mapName, mapData] of Object.entries(apiData[mapCategory])) {
        if (mapName.replace(/\s/g, "") === gameData.map.replace(/\s/g, "")) {
          return mapData;
        }
      }
    } else {
      console.error("Unexpected error: Did not find the map category " + mapCategory + " in api");
    }
  }
  return undefined;
};

const parseSideData = (logFileTeam: LogFileTeamData, apiData: PersonalStatResponse): SideData => {
  const { statGroups, leaderboardStats } = apiData;
  const soloData: LadderStats[] = new Array(logFileTeam.players.length);
  const unfinishedSoloLadderDatas: Map<number, undefined> = new Map(
    logFileTeam.players.map((p, i) => [i, undefined]),
  );
  const unfinishedSoloMemberDatas: Map<number, undefined> = new Map(
    logFileTeam.players.map((p, i) => [i, undefined]),
  );
  // create a starter to populate later
  logFileTeam.players.forEach((logFilePlayer, index) => {
    const soloMember: Member = {
      ai: logFilePlayer.ai,
      relicID: logFilePlayer.ai ? -(index + 1) : parseInt(logFilePlayer.relicID, 10),
      name: logFilePlayer.name,
      faction: logFilePlayer.faction,
      steamID: "",
      xp: -1,
      level: -1,
      country: "",
    };
    if (logFilePlayer.ai) {
      unfinishedSoloLadderDatas.delete(index);
      unfinishedSoloMemberDatas.delete(index);
    }
    soloData[index] = {
      members: [soloMember],
      wins: -1,
      losses: -1,
      streak: -1,
      disputes: -1,
      drops: -1,
      rank: -1,
      ranktotal: -1,
      ranklevel: -1,
      regionrank: -1,
      regionranktotal: -1,
      lastmatchdate: -1,
    };
  });
  const teamData: Record<string, LadderStats> = {};

  findMemberInfos(statGroups, unfinishedSoloMemberDatas, soloData);

  leaderboardStats.forEach((leaderboardStat) => {
    // add additional data to solo entries
    processSoloLeaderboardStats(
      leaderboardStat,
      statGroups,
      unfinishedSoloLadderDatas,
      soloData,
      logFileTeam.players.length,
    );
    processTeamLeaderboardStats(leaderboardStat, statGroups, logFileTeam, teamData);
  });
  // sort teamdata so that biggest teams come first
  const sortedTeamData = Object.values(teamData).sort(
    (a, b) => (b.members.length - a.members.length) * 100 + (b.ranklevel - a.ranklevel),
  );
  findTeamRankingForSoloStats(soloData, sortedTeamData);
  // find actual ranking for the game
  const countingRanks = findAllStatsForEachPlayerInSide({
    side: logFileTeam.side,
    solo: soloData,
    teams: sortedTeamData,
    averageLevel: undefined,
    averageWinRatio: undefined,
  });
  if (allPlayersInSideHaveRanking(countingRanks)) {
    // calculate average level
    const averageLevel = GetAverageTeamValue(countingRanks, (stats) => stats.ranklevel);
    // calculate average win ratio
    const averageRatio = GetAverageTeamValue(
      countingRanks,
      (stats) => (stats.wins / (stats.wins + stats.losses)) * 100,
    );
    return {
      side: logFileTeam.side,
      solo: soloData,
      teams: sortedTeamData,
      averageLevel: averageLevel,
      averageWinRatio: averageRatio,
    };
  }
  return {
    side: logFileTeam.side,
    solo: soloData,
    teams: sortedTeamData,
    averageLevel: undefined,
    averageWinRatio: undefined,
  };
};

const allPlayersInSideHaveRanking = (statsMatrix: LadderStats[][]): boolean => {
  let allHaveARanking = true;
  statsMatrix.forEach((stats) => {
    if (stats.length === 0) {
      allHaveARanking = false;
    }
  });
  return allHaveARanking;
};

const findAllStatsForEachPlayerInSide = (side: SideData): LadderStats[][] => {
  const result: LadderStats[][] = new Array(side.solo.length);
  side.solo.forEach((soloStat, index) => {
    result[index] = [];
    // only include stats with a ranking
    if (soloStat.rank > 0) {
      result[index].push(soloStat);
    }
    side.teams.forEach((teamStat) => {
      if (teamStat.rank > 0) {
        teamStat.members.forEach((teamMember) => {
          if (teamMember.relicID === soloStat.members[0].relicID) {
            result[index].push(teamStat);
          }
        });
      }
    });
  });
  return result;
};

const GetAverageTeamValue = (
  statsMatrix: LadderStats[][],
  mapFunc: (stats: LadderStats) => number,
): number => {
  const flatLadderStatsArray = statsMatrix.flat(1);
  return (
    flatLadderStatsArray.map(mapFunc).reduce((a, b) => a + b, 0) / flatLadderStatsArray.length ||
    0
  );
};

/**
 * Looks if players belong to a team and adds the team ranking and level to the players ladder stats
 * @param soloData Array of ladder data for each player on one side that will be extended with teamdata
 * @param sortedTeamData Array of ladder data for all teams found for the players of that side
 */
const findTeamRankingForSoloStats = (
  soloData: LadderStats[],
  sortedTeamData: LadderStats[],
): void => {
  // find the biggest team each player belongs too and set players team rank value
  for (let i = 0; i < soloData.length; i++) {
    const soloMember = soloData[i].members[0];
    // skip ai
    if (!soloMember.ai) {
      let j = 0;
      while (!soloData[i].teamrank && j < sortedTeamData.length) {
        const currentTeamData = sortedTeamData[j];
        const teamId = j;
        currentTeamData.members.forEach((member) => {
          if (member.relicID === soloMember.relicID) {
            soloData[i].teamrank = currentTeamData.rank;
            soloData[i].teamId = teamId;
          }
        });
        j++;
      }
    }
  }
};

const findMemberInfos = (
  statGroups: StatGroup[],
  unfinishedSoloMemberDatas: Map<number, undefined>,
  soloData: LadderStats[],
) => {
  for (let i = 0; i < statGroups.length; i++) {
    if (unfinishedSoloMemberDatas.size > 0) {
      const members = statGroups[i].members;
      members.forEach((member) => {
        const keysToDelete: number[] = [];
        unfinishedSoloMemberDatas.forEach((v, k) => {
          if (member.profile_id === soloData[k].members[0].relicID) {
            setMemberWithStatGroupMember(member, soloData[k].members[0]);
            keysToDelete.push(k);
          }
        });
        keysToDelete.forEach((key) => {
          unfinishedSoloMemberDatas.delete(key);
        });
      });
    } else {
      return;
    }
  }
};

const processSoloLeaderboardStats = (
  leaderboardStat: LeaderboardStat,
  statGroups: StatGroup[],
  unfinishedSoloLadderDatas: Map<number, undefined>,
  soloData: LadderStats[],
  playerCount: number,
) => {
  const leaderboardId = leaderboardStat.leaderboard_id;
  if (
    unfinishedSoloLadderDatas.size > 0 &&
    ((leaderboardId > 3 && leaderboardId < 20) || (leaderboardId > 50 && leaderboardId < 55))
  ) {
    const soloStatGroup = statGroups.find(
      (statGroup) => statGroup.id === leaderboardStat.statgroup_id,
    );
    if (soloStatGroup) {
      let matchingPlayerId: number | undefined = undefined;
      unfinishedSoloLadderDatas.forEach((v, k) => {
        const wantedLeaderboardId =
          leaderboardIDLookupTable[soloData[k].members[0].faction][playerCount - 1];
        if (
          soloData[k].members[0].relicID === soloStatGroup.members[0].profile_id &&
          wantedLeaderboardId === leaderboardId
        ) {
          // found the right entry
          copyLeaderboardStatsToLadderStats(leaderboardStat, soloData[k]);
          matchingPlayerId = k;
        }
      });
      unfinishedSoloLadderDatas.delete(matchingPlayerId);
    }
  }
};

const processTeamLeaderboardStats = (
  leaderboardStat: LeaderboardStat,
  statGroups: StatGroup[],
  logFileTeam: LogFileTeamData,
  teamData: Record<string, LadderStats>,
) => {
  const leaderboardId = leaderboardStat.leaderboard_id;
  const validIds = teamLeaderboardIdsLookupTable[logFileTeam.side].slice(
    0,
    logFileTeam.players.length - 1,
  );
  if (validIds.includes(leaderboardId)) {
    // team ranking
    const teamStatGroup = statGroups.find(
      (statGroup) => statGroup.id === leaderboardStat.statgroup_id,
    );
    if (teamStatGroup) {
      // check if all members of statgroup are playing in the match
      const result = checkIfAllMembersArePlaying(teamStatGroup.members, logFileTeam.players);
      if (result) {
        // generate unique index by concatenating sorted relicIds
        const uniqueTeamId = teamStatGroup.members
          .map((member) => member.profile_id)
          .sort((a, b) => a - b)
          .map((relicId) => "" + relicId)
          .join("");
        const teamMembers: Member[] = new Array(teamStatGroup.members.length);
        for (let k = 0; k < teamStatGroup.members.length; k++) {
          const statGroupMember = teamStatGroup.members[k];
          const matchedSideMember = result[k];
          const teamMemberSteamStringSplit = statGroupMember.name.split("/") as string[];
          teamMembers[k] = {
            ai: false,
            relicID: statGroupMember.profile_id,
            name: matchedSideMember.name,
            faction: matchedSideMember.faction,
            steamID: teamMemberSteamStringSplit[teamMemberSteamStringSplit.length - 1],
            xp: statGroupMember.xp,
            level: statGroupMember.level,
            country: statGroupMember.country,
          };
        }
        const teamLadderStats: LadderStats = {
          members: teamMembers,
          wins: -1,
          losses: -1,
          streak: -1,
          disputes: -1,
          drops: -1,
          rank: -1,
          ranktotal: -1,
          ranklevel: -1,
          regionrank: -1,
          regionranktotal: -1,
          lastmatchdate: -1,
        };
        copyLeaderboardStatsToLadderStats(leaderboardStat, teamLadderStats);
        teamData[uniqueTeamId] = teamLadderStats;
      }
    }
  }
};

/**
 * Checks if all members of a team are within the list of players in the game
 * @param members members in the team
 * @param players players in the game
 * @returns true if all members are in the game => if team should be added to list of teams of that game
 */
const checkIfAllMembersArePlaying = (
  members: StatGroupMember[],
  players: LogFilePlayerData[],
) => {
  let isPlaying = true;
  let statGroupMemberId = 0;
  const matchedLogFilePlayers: LogFilePlayerData[] = new Array(members.length);
  while (statGroupMemberId < members.length) {
    const teamStatMemberRelicId = members[statGroupMemberId].profile_id;
    let foundMember = false;
    let logFilePlayerId = 0;
    while (logFilePlayerId < players.length) {
      const logFilePlayerRelicId = parseInt(players[logFilePlayerId].relicID, 10);
      if (teamStatMemberRelicId === logFilePlayerRelicId) {
        foundMember = true;
        matchedLogFilePlayers[statGroupMemberId] = players[logFilePlayerId];
        logFilePlayerId = players.length;
      }
      logFilePlayerId++;
    }
    if (!foundMember) {
      isPlaying = false;
      statGroupMemberId = members.length;
    }
    statGroupMemberId++;
  }
  if (isPlaying) {
    return matchedLogFilePlayers;
  }
  return false;
};

const setMemberWithStatGroupMember = (statGroupMember: StatGroupMember, member: Member) => {
  member.relicID = statGroupMember.profile_id;
  const steamStringSplit = statGroupMember.name.split("/") as string[];
  member.steamID = steamStringSplit[steamStringSplit.length - 1];
  member.xp = statGroupMember.xp;
  member.level = statGroupMember.level;
  member.country = statGroupMember.country;
};

const copyLeaderboardStatsToLadderStats = (
  leaderboardStats: LeaderboardStat,
  ladderStats: LadderStats,
) => {
  ladderStats.wins = leaderboardStats.wins;
  ladderStats.losses = leaderboardStats.losses;
  ladderStats.streak = leaderboardStats.streak;
  ladderStats.disputes = leaderboardStats.disputes;
  ladderStats.drops = leaderboardStats.drops;
  ladderStats.rank = leaderboardStats.rank;
  ladderStats.ranktotal = leaderboardStats.ranktotal;
  ladderStats.ranklevel = leaderboardStats.ranklevel;
  ladderStats.regionrank = leaderboardStats.regionrank;
  ladderStats.regionranktotal = leaderboardStats.regionranktotal;
  ladderStats.lastmatchdate = leaderboardStats.lastmatchdate;
};

const fetchDataFromRelicAPI = (
  game: LogFileGameData,
): Promise<AxiosResponse<PersonalStatResponse>> => {
  const profile_ids = game.left.players
    .concat(game.right.players)
    .filter((player) => !player.ai)
    .map((player) => player.relicID)
    .join();
  const requestURL =
    "https://coh2-api.reliclink.com/community/leaderboard/GetPersonalStat?title=coh2&profile_ids=[" +
    profile_ids +
    "]";
  console.log("Relic API request");
  return axios.get(requestURL);
};
