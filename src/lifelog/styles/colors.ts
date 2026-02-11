import { settingdata } from "@/index";


// 导出颜色生成函数
export function getCategoryColor(priority: string = '无') {
    if (settingdata["cal-event-color"]) {
        // 使用黄金角算法生成随机颜色
        const hash = Array.from(priority).reduce((acc, char) => {
            return char.charCodeAt(0) + ((acc << 5) - acc);
        }, 0);
        const [backgroundColor, textColor, borderColor] = getRandomColors(Math.abs(hash));
        return {
            border: borderColor,
            background: backgroundColor,
            text: textColor
        };
    } else {
        // 使用预定义的颜色映射，参考滴答清单的配色
        const hueMap = {
            "高": 0,      // 红色
            "中": 35,     // 橙色
            "低": 200,    // 蓝色
            "无": 0       // 灰色（使用0饱和度）
        };

        // 为不同优先级设置不同的饱和度和亮度
        const colorParams = {
            "高": { s: 80, l: 70 },    // 柔和的红色，降低饱和度，提高亮度
            "中": { s: 80, l: 70 },    // 温暖的橙色
            "低": { s: 75, l: 75 },    // 柔和的蓝色
            "无": { s: 0, l: 75 }      // 中性灰色
        };

        const hue = hueMap[priority] || hueMap['无'];
        const params = colorParams[priority] || colorParams['无'];
        const [backgroundColor, textColor, borderColor] = getFixedColors(hue, priority === '无', params.s, params.l);
        return {
            border: borderColor,
            background: backgroundColor,
            text: textColor
        };
    }
}

// 使用黄金角算法生成随机颜色
function getRandomColors(index: number): string[] {
    const hue = index * 137.508; // 黄金角近似值
    return generateColors(hue);
}

// 根据固定色相生成颜色
function getFixedColors(hue: number, isGray: boolean = false, saturation: number = 75, lightness: number = 75): string[] {
    if (isGray) {
        // 对于灰色，使用0饱和度
        return [
            `hsl(0,0%,75%)`,            // 背景色（浅灰色）
            "black",                     // 文字颜色
            `hsl(0,0%,45%)`             // 边框颜色（深灰色）
        ];
    }

    const rgb = hsl2rgb(hue, saturation/100, lightness/100);

    // 生成边框颜色：使用相同色相但更深的颜色
    const borderSaturation = `${Math.min(saturation + 10, 100)}%`;
    const borderLightness = `${Math.max(lightness - 20, 25)}%`;

    const textColor = colourIsLight(rgb[0], rgb[1], rgb[2]) ? "black" : "white";

    return [
        `hsl(${hue},${saturation}%,${lightness}%)`,           // 背景色
        textColor,                                            // 文字颜色
        `hsl(${hue},${borderSaturation},${borderLightness})`  // 边框颜色
    ];
}

// 统一的颜色生成逻辑
function generateColors(hue: number): string[] {
    const rgb = hsl2rgb(hue, 0.75, 0.75);

    // 生成边框颜色：使用相同色相但更深的颜色
    const borderSaturation = '85%';
    const borderLightness = '45%';

    const textColor = colourIsLight(rgb[0], rgb[1], rgb[2]) ? "black" : "white";

    return [
        `hsl(${hue},75%,75%)`,           // 背景色
        textColor,                        // 文字颜色
        `hsl(${hue},${borderSaturation},${borderLightness})`  // 边框颜色
    ];
}

// 保留原有的 lifelogColors 配置
export const lifelogColors = {
    '固定': {
        border: 'rgb(211, 211, 211)',
        background: 'rgba(211, 211, 211, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '出行': {
        border: 'rgb(211, 211, 211)',
        background: 'rgba(211, 211, 211, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '琐事': {
        border: 'rgb(211, 211, 211)',
        background: 'rgba(211, 211, 211, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '睡眠': {
        border: 'rgb(106, 90, 205)',
        background: 'rgba(106, 90, 205, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '健康': {
        border: 'rgb(60, 179, 113)',
        background: 'rgba(60, 179, 113, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '学习': {
        border: 'rgb(144, 238, 144)',
        background: 'rgba(144, 238, 144, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '阅读': {
        border: 'rgb(144, 238, 144)',
        background: 'rgba(144, 238, 144, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '事业': {
        border: 'rgb(144, 238, 144)',
        background: 'rgba(144, 238, 144, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '增': {
        border: 'rgb(144, 238, 144)',
        background: 'rgba(144, 238, 144, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '工作': {
        border: 'rgb(255, 215, 0)',
        background: 'rgba(255, 215, 0, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '娱乐': {
        border: 'rgb(255, 0, 0)',
        background: 'rgba(255, 0, 0, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '荒废': {
        border: 'rgb(255, 0, 0)',
        background: 'rgba(255, 0, 0, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '废': {
        border: 'rgb(255, 0, 0)',
        background: 'rgba(255, 0, 0, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '玩': {
        border: 'rgb(255, 0, 0)',
        background: 'rgba(255, 0, 0, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '家庭': {
        border: 'rgb(71, 255, 248)',
        background: 'rgba(71, 255, 248, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '家': {
        border: 'rgb(71, 255, 248)',
        background: 'rgba(71, 255, 248, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '朋友': {
        border: 'rgb(156, 123, 85)',
        background: 'rgba(156, 123, 85, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
    '友': {
        border: 'rgb(156, 123, 85)',
        background: 'rgba(156, 123, 85, 0.15)',
        text: 'var(--b3-theme-on-background)'
    },
};


function hsl2rgb(h: number, s: number, l: number): number[] { // Copied from https://stackoverflow.com/a/54014428/13231742
    let a = s * Math.min(l, 1 - l);
    let f = (n: number, k = (n + h / 30) % 12) => l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return [f(0) * 255, f(8) * 255, f(4) * 255];
}

var colourIsLight = function (r: number, g: number, b: number) { // Copied from https://codepen.io/WebSeed/full/pvgqEq/

    // Counting the perceptive luminance
    // human eye favors green color...
    var a = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return (a < 0.5);
}
