import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			bronze: {
  				50: '#faf7f1',
  				100: '#f5f0e6',
  				200: '#ede7db',
  				300: '#e2dbd0',
  				400: '#d4cbbf',
  				500: '#a89d90',
  				600: '#7a7068',
  				700: '#5c534b',
  				800: '#3a342e',
  				900: '#2a2520',
  			},
  			// Action accents — warm, muted, imperial
  			steel: {
  				DEFAULT: '#5b83b0',
  				light: '#6d94bf',
  				dark: '#4a72a0',
  			},
  			gold: {
  				DEFAULT: '#c9a84c',
  				light: '#d4b85e',
  				dark: '#b8953d',
  			},
  			patina: {
  				DEFAULT: '#6a9a58',
  				light: '#7baa6a',
  				dark: '#5a8a48',
  			},
  			crimson: {
  				DEFAULT: '#b35a5a',
  				light: '#c06b6b',
  				dark: '#a04a4a',
  			},
  			// Semantic design tokens — light/dark handled via CSS variables
  			'surface-base': 'var(--surface-base)',
  			'surface-primary': 'var(--surface-primary)',
  			'surface-secondary': 'var(--surface-secondary)',
  			'surface-hover': 'var(--surface-hover)',
  			'border-default': 'var(--border-default)',
  			'border-hover': 'var(--border-hover)',
  			'border-subtle': 'var(--border-subtle)',
  			'text-chrome': 'var(--text-chrome)',
  			'text-chrome-hover': 'var(--text-chrome-hover)',
  			'text-chrome-active': 'var(--text-chrome-active)',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
export default config;
