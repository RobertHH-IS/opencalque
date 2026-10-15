/*
 * Walls (ARCHITECTURE §4, "Walls"). A wall is its line and a thickness; everything else about it is
 * worked out from where it is: its corners, its doors and windows, the rooms it bounds.
 *
 *   course    the line a wall follows, straight or curved, and what is measured along and across it
 *   spatial   the indexes of wall ends and walls, made once for each state of the drawing
 *   openings  doors and windows: which wall each is in, and putting one on a wall
 *   joints    corners: how the faces of walls that meet are brought together, and the corner as a place
 *   outline   what a wall draws: its pieces, the lines across its ends, which lines are shown
 *   edit      changes that keep the plan in one piece: following a move, thickness, splitting, extending
 */
export { bulgeThrough, distToWall, wallArc, wallContains, wallLength, wallMiddle, wallParallel, wallPoints, wallSides, wallSpot, type WallArc } from './course'
export { autoJoinCuts, connectedWalls, cornerJoin, cornerJoinOps, moveCornerOps, wallEndsAt, type WallEnd, type WallJoin } from './joints'
export { hostWall, openingSpan, snapOpeningToWall, wallOpenings } from './openings'
export { endLineOps, endLineShown, endLineUsual, wallEdgeLines, wallOutline, wallOutlineRuns, wallPolygons, wallSeams, withEdge } from './outline'
export { extendWallOps, splitWallOps, trimWallOps, wallEndFollowOps, wallFollowOps, wallJustifyOps, wallThicknessOps } from './edit'
