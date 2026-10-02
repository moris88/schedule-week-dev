/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				p1Color: '#ef4444',
				p2Color: '#f59e0b',
				p3Color: '#10b981',
				fixColor: '#8b5cf6',
				meetingColor: '#3b82f6',
			},
		},
	},
	plugins: [],
}
