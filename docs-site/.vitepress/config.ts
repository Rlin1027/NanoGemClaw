import { defineConfig } from 'vitepress'

export default defineConfig({
    title: 'NanoGemClaw',
    description: 'Personal AI assistant powered by Gemini, delivered via Telegram',

    base: '/NanoGemClaw/',

    head: [['link', { rel: 'icon', href: '/logo.svg' }]],

    locales: {
        root: {
            label: 'English',
            lang: 'en',
            themeConfig: {
                nav: [
                    { text: 'Guide', link: '/guide/quickstart' },
                    { text: 'Tutorials', link: '/tutorials/customer-service-bot' },
                    { text: 'Plugins', link: '/plugins/getting-started' },
                    { text: 'Reference', link: '/reference/api' },
                ],
                sidebar: {
                    '/guide/': [
                        {
                            text: 'Guide',
                            items: [
                                { text: 'Quick Start', link: '/guide/quickstart' },
                                {
                                    text: 'Installation',
                                    link: '/guide/installation',
                                },
                                {
                                    text: 'Configuration',
                                    link: '/guide/configuration',
                                },
                                {
                                    text: 'Building & Running',
                                    link: '/guide/building-running',
                                },
                                { text: 'Dashboard', link: '/guide/dashboard' },
                            ],
                        },
                    ],
                    '/tutorials/': [
                        {
                            text: 'Tutorials',
                            items: [
                                {
                                    text: 'Customer Service Bot',
                                    link: '/tutorials/customer-service-bot',
                                },
                                {
                                    text: 'Daily Report Scheduler',
                                    link: '/tutorials/daily-report-scheduler',
                                },
                            ],
                        },
                    ],
                    '/plugins/': [
                        {
                            text: 'Plugins',
                            items: [
                                {
                                    text: 'Getting Started',
                                    link: '/plugins/getting-started',
                                },
                                {
                                    text: 'Weather Plugin',
                                    link: '/plugins/examples/weather-plugin',
                                },
                                {
                                    text: 'Reminder Plugin',
                                    link: '/plugins/examples/reminder-plugin',
                                },
                            ],
                        },
                    ],
                    '/reference/': [
                        {
                            text: 'Reference',
                            items: [
                                {
                                    text: 'API Reference',
                                    link: '/reference/api',
                                },
                                {
                                    text: 'Architecture',
                                    link: '/reference/architecture',
                                },
                                {
                                    text: 'Environment Variables',
                                    link: '/reference/environment-variables',
                                },
                            ],
                        },
                    ],
                    '/deployment/': [
                        {
                            text: 'Operations',
                            items: [
                                {
                                    text: 'Deployment',
                                    link: '/deployment/',
                                },
                                {
                                    text: 'Troubleshooting',
                                    link: '/troubleshooting/',
                                },
                            ],
                        },
                    ],
                    '/troubleshooting/': [
                        {
                            text: 'Operations',
                            items: [
                                {
                                    text: 'Deployment',
                                    link: '/deployment/',
                                },
                                {
                                    text: 'Troubleshooting',
                                    link: '/troubleshooting/',
                                },
                            ],
                        },
                    ],
                },
            },
        },
        'zh-TW': {
            label: '繁體中文',
            lang: 'zh-TW',
            link: '/zh-TW/',
            themeConfig: {
                nav: [
                    { text: '指南', link: '/zh-TW/guide/quickstart' },
                    {
                        text: '教學',
                        link: '/zh-TW/tutorials/customer-service-bot',
                    },
                    {
                        text: '外掛程式',
                        link: '/zh-TW/plugins/getting-started',
                    },
                    { text: '參考', link: '/zh-TW/reference/api' },
                ],
                sidebar: {
                    '/zh-TW/guide/': [
                        {
                            text: '指南',
                            items: [
                                {
                                    text: '快速開始',
                                    link: '/zh-TW/guide/quickstart',
                                },
                                {
                                    text: '安裝',
                                    link: '/zh-TW/guide/installation',
                                },
                                {
                                    text: '設定',
                                    link: '/zh-TW/guide/configuration',
                                },
                                {
                                    text: '建置與執行',
                                    link: '/zh-TW/guide/building-running',
                                },
                                {
                                    text: '控制面板',
                                    link: '/zh-TW/guide/dashboard',
                                },
                            ],
                        },
                    ],
                    '/zh-TW/tutorials/': [
                        {
                            text: '教學',
                            items: [
                                {
                                    text: '客服機器人',
                                    link: '/zh-TW/tutorials/customer-service-bot',
                                },
                                {
                                    text: '每日報告排程',
                                    link: '/zh-TW/tutorials/daily-report-scheduler',
                                },
                            ],
                        },
                    ],
                    '/zh-TW/plugins/': [
                        {
                            text: '外掛程式',
                            items: [
                                {
                                    text: '入門指南',
                                    link: '/zh-TW/plugins/getting-started',
                                },
                                {
                                    text: '天氣外掛',
                                    link: '/zh-TW/plugins/examples/weather-plugin',
                                },
                                {
                                    text: '提醒外掛',
                                    link: '/zh-TW/plugins/examples/reminder-plugin',
                                },
                            ],
                        },
                    ],
                    '/zh-TW/reference/': [
                        {
                            text: '參考',
                            items: [
                                {
                                    text: 'API 參考',
                                    link: '/zh-TW/reference/api',
                                },
                                {
                                    text: '架構概覽',
                                    link: '/zh-TW/reference/architecture',
                                },
                                {
                                    text: '環境變數',
                                    link: '/zh-TW/reference/environment-variables',
                                },
                            ],
                        },
                    ],
                    '/zh-TW/deployment/': [
                        {
                            text: '維運',
                            items: [
                                {
                                    text: '部署',
                                    link: '/zh-TW/deployment/',
                                },
                                {
                                    text: '疑難排解',
                                    link: '/zh-TW/troubleshooting/',
                                },
                            ],
                        },
                    ],
                    '/zh-TW/troubleshooting/': [
                        {
                            text: '維運',
                            items: [
                                {
                                    text: '部署',
                                    link: '/zh-TW/deployment/',
                                },
                                {
                                    text: '疑難排解',
                                    link: '/zh-TW/troubleshooting/',
                                },
                            ],
                        },
                    ],
                },
                outline: { label: '本頁目錄' },
                docFooter: { prev: '上一頁', next: '下一頁' },
                lastUpdated: { text: '最後更新' },
                returnToTopLabel: '返回頂部',
                sidebarMenuLabel: '選單',
                darkModeSwitchLabel: '主題',
                langMenuLabel: '語言',
            },
        },
    },

    themeConfig: {
        logo: '/logo.svg',
        socialLinks: [
            {
                icon: 'github',
                link: 'https://github.com/Rlin1027/NanoGemClaw',
            },
        ],
        search: { provider: 'local' },
        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2024-present NanoGemClaw Contributors',
        },
    },

    vite: {
        server: {
            port: 5174,
        },
    },
})
