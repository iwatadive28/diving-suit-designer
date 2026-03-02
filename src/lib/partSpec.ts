import type { Part } from "../types";

export const SUIT_SOURCE_SIZE = { width: 1104, height: 960 };

export const PART_DEFINITIONS: Part[] = [
  { id: "1", name: "首周り", defaultColor: "black", allowColors: ["black"], originalRef: "m01" },
  { id: "2", name: "胸上部（前）", defaultColor: "black", allowColors: ["all"], originalRef: "m02" },
  { id: "3", name: "胸上部（後）", defaultColor: "black", allowColors: ["all"], originalRef: "m03" },
  { id: "4", name: "左肩", defaultColor: "black", allowColors: ["all"], originalRef: "m05" },
  { id: "5", name: "右肩", defaultColor: "black", allowColors: ["all"], originalRef: "m04" },
  { id: "6", name: "胸前", defaultColor: "black", allowColors: ["all"], originalRef: "m06" },
  { id: "7", name: "背中中央", defaultColor: "black", allowColors: ["all"], originalRef: "m07" },
  { id: "8", name: "胸下部・腹部・腕", defaultColor: "black", allowColors: ["all"], originalRef: "m08" },
  { id: "9", name: "背中下部", defaultColor: "black", allowColors: ["all"], originalRef: "m09" },
  { id: "10", name: "脇左右", defaultColor: "black", allowColors: ["all"], originalRef: "m13" },
  { id: "11", name: "下腹部", defaultColor: "black", allowColors: ["all"], originalRef: "m11" },
  { id: "12", name: "腹ライン左右", defaultColor: "black", allowColors: ["all"], originalRef: "m12" },
  { id: "13", name: "腰・臀部", defaultColor: "black", allowColors: ["all"], originalRef: "m10" },
  { id: "14", name: "腿前外左右", defaultColor: "black", allowColors: ["all"], originalRef: "m14" },
  { id: "15", name: "内股前後", defaultColor: "black", allowColors: ["all"], originalRef: "m15" },
  { id: "16", name: "膝パッド", defaultColor: "white", allowColors: ["white", "black"], originalRef: "m19" },
  { id: "17", name: "膝裏", defaultColor: "black", allowColors: ["all"], originalRef: "m16" },
  { id: "18", name: "脛・脹脛", defaultColor: "black", allowColors: ["all"], originalRef: "m17" },
  { id: "19", name: "裾", defaultColor: "black", allowColors: ["black"], originalRef: "m18" },
  { id: "20", name: "リブ", defaultColor: "black", allowColors: ["black"], originalRef: "m20" }
];
