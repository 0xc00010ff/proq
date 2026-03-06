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
  			// Semantic design tokens — RGB channels, supports Tailwind opacity modifiers
  			'surface-base': 'rgb(var(--surface-base) / <alpha-value>)',
  			'surface-primary': 'rgb(var(--surface-primary) / <alpha-value>)',
  			'surface-secondary': 'rgb(var(--surface-secondary) / <alpha-value>)',
  			'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
  			'surface-selected': 'rgb(var(--surface-selected) / <alpha-value>)',
  			'surface-modal': 'rgb(var(--surface-modal) / <alpha-value>)',
  			'surface-topbar': 'rgb(var(--surface-topbar) / <alpha-value>)',
  			'surface-detail': 'rgb(var(--surface-detail) / <alpha-value>)',
  			'surface-inset': 'rgb(var(--surface-inset) / <alpha-value>)',
  			'surface-deep': 'rgb(var(--surface-deep) / <alpha-value>)',
  			'border-default': 'rgb(var(--border-default) / <alpha-value>)',
  			'border-hover': 'rgb(var(--border-hover) / <alpha-value>)',
  			'border-subtle': 'rgb(var(--border-subtle) / <alpha-value>)',
  			'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
  			'text-chrome': 'rgb(var(--text-chrome) / <alpha-value>)',
  			'text-chrome-hover': 'rgb(var(--text-chrome-hover) / <alpha-value>)',
  			'text-chrome-active': 'rgb(var(--text-chrome-active) / <alpha-value>)',
  			'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
  			'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
  			'text-tertiary': 'rgb(var(--text-tertiary) / <alpha-value>)',
  			'text-placeholder': 'rgb(var(--text-placeholder) / <alpha-value>)',
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
