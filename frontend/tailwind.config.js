/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主色调 - Create 暖陶土橙
        primary: {
          50: '#fff4ee',
          100: '#ffe3d6',
          200: '#fbc6b0',
          300: '#f5a17f',
          400: '#ef8a64',
          500: '#e8794e',
          600: '#d05f36',
          700: '#ad4a29',
          800: '#8b3d23',
          900: '#71331f',
          950: '#3d190d'
        },
        // 辅助色 - 暖中性灰
        accent: {
          50: '#faf8f4',
          100: '#f2ede5',
          200: '#e3dbd0',
          300: '#c9c1b6',
          400: '#a79f94',
          500: '#837b71',
          600: '#5f5951',
          700: '#423d37',
          800: '#2c2925',
          900: '#211f1c',
          950: '#181715'
        },
        // 深色模式 - 暖石墨
        dark: {
          50: '#faf8f4',
          100: '#f2ede5',
          200: '#e3dbd0',
          300: '#c9c1b6',
          400: '#a79f94',
          500: '#837b71',
          600: '#5f5951',
          700: '#423d37',
          800: '#2c2925',
          900: '#211f1c',
          950: '#181715'
        }
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.08)',
        'glass-sm': '0 4px 16px rgba(0, 0, 0, 0.06)',
        glow: '0 0 20px rgba(232, 121, 78, 0.2)',
        'glow-lg': '0 0 40px rgba(232, 121, 78, 0.28)',
        card: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 12px 36px rgba(0, 0, 0, 0.18)',
        'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.1)'
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-primary': 'linear-gradient(135deg, #e8794e 0%, #d05f36 100%)',
        'gradient-dark': 'linear-gradient(135deg, #2c2925 0%, #181715 100%)',
        'gradient-glass':
          'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
        'mesh-gradient': 'linear-gradient(180deg, rgba(232, 121, 78, 0.045) 0%, transparent 30%)'
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2s linear infinite',
        glow: 'glow 2s ease-in-out infinite alternate'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(232, 121, 78, 0.2)' },
          '100%': { boxShadow: '0 0 30px rgba(232, 121, 78, 0.3)' }
        }
      },
      backdropBlur: {
        xs: '2px'
      },
      borderRadius: {
        '4xl': '2rem'
      }
    }
  },
  plugins: []
}
