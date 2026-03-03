export type Color = {
  id: string;
  name: string;
  hex: string;
  patternTile?: string;
  enabled: boolean;
  order: number;
};

export type ColorTheme = {
  id: string;
  name: string;
  colors: string[];
  stitchColors?: string[];
};

export type Part = {
  id: string;
  name: string;
  defaultColor: string;
  allowColors: string[];
  originalRef?: string;
};

export type Preset = {
  id: string;
  name: string;
  parts: Record<string, string>;
};

export type LogoPlacement = {
  id: string;
  x: number;
  y: number;
};

export type SuitState = {
  parts: Record<string, string>;
  preset?: string;
  stitchColor?: string;
  logos?: LogoPlacement[];
};

export type AppConfig = {
  colors: Color[];
  parts: Part[];
  presets: Preset[];
  stitchColors: Color[];
  colorThemes: ColorTheme[];
};

export type Toast = {
  id: string;
  message: string;
};
