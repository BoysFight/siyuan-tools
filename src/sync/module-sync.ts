import steveTools from "@/index";
import * as api from "@/api/api"
import { showMessage } from "siyuan";
import { moduleInstances } from '@/index';
import { M_didaSync } from './module-dida-sync';
import { getFrontend, getBackend} from 'siyuan';

declare const siyuan: any;

let url = "";
let token = "";

export class M_sync {
    private plugin: steveTools;
    private settingdata: any;
    private dockerSyncEnabled: boolean = false;
    private didaSyncInstance: M_didaSync;

    constructor(plugin: steveTools) {
        this.plugin = plugin;
        this.didaSyncInstance = new M_didaSync(plugin);
    }

    init = async (settingdata) => {
        this.settingdata = settingdata;
        console.log("同步模块初始化中...");

        // 分别初始化docker感知和滴答清单同步
        await this.initDockerSync();
        await this.didaSyncInstance.init(settingdata);
        this.setupSyncListener(); // 改为调用通用监听器

        console.log("同步模块初始化完成");
    }

    // 独立的docker感知同步初始化
    private async initDockerSync() {
        this.dockerSyncEnabled = this.settingdata["sync-enable"];
        if (this.dockerSyncEnabled) {
            url = this.settingdata["sync-url"]; // 兼容旧配置
            token = this.settingdata["sync-token"]; // 兼容旧配置
            console.log("Docker感知同步已启用");
        }
    }

    // 通用同步监听器 - 只负责监听同步事件，不包含具体业务逻辑
    private setupSyncListener() {
        siyuan.ws.ws.addEventListener('message', async (e) => {
            const msg = JSON.parse(e.data);
            if (msg.cmd === "syncing") {
                if (msg.msg && msg.msg.startsWith('上传')) {
                    console.log("同步结束完成上传，开始同步滴答清单或同步感知");
                    // 获取并打印当前前后端类型
                    const frontend = getFrontend();
                    const backend = getBackend();
                    console.log(`[平台信息] 前端类型: ${frontend}, 后端类型: ${backend}`);

                    // 检查是否为主窗口或桌面客户端，只有主窗口或桌面客户端才执行同步
                    const isMainWindow = window.location.port === '6806' || window.location.port === '16806';
                    const isDesktopWindows = frontend === 'desktop' && backend === 'windows';
                    
                    if (!isMainWindow && !isDesktopWindows) {
                        const currentPort = window.location.port;
                        const reason = `当前端口 ${currentPort} 不是主窗口(6806或16806)且不是Windows桌面客户端`;
                        console.log(`[同步跳过] ${reason}`);
                        showMessage(`同步操作已跳过：${reason}`, 3000);
                        return;
                    }
                    // 已通过前面的条件检查，现在可以执行同步操作
                    console.log('[同步执行] 当前是主窗口或桌面客户端，开始执行同步操作');

                    // 处理滴答清单同步
                    if (this.didaSyncInstance["mydidaSyncEnabled"] &&
                        this.settingdata["docker-sync-auto-trigger-dida"]) {
                            await this.didaSyncInstance.syncToDidaList();
                    }

                    // 处理 Docker 同步
                    if (this.dockerSyncEnabled) {
                        const currentHost = window.location.host;
                        
                        if (url.includes(currentHost)) {
                            console.log("[Docker同步] 当前主机已包含在同步URL中，取消感知");
                        } else {
                            console.log("[Docker同步] 延迟1秒后执行Docker同步");
                            setTimeout(async () => {
                                await this.handleDockerSync();
                            }, 1000);
                        }
                    }
                }
            }
        });
    }


    // 独立的docker同步处理方法 - 添加了完善的图标恢复逻辑
    private async handleDockerSync() {
        if (!this.dockerSyncEnabled) {
            console.log("Docker感知同步未启用");
            return;
        }

        let originalIcon = "#iconST"; // 设置为插件的默认图标
        const iconElement = document.querySelector('#plugin_siyuan-steve-tools_0 svg use');

        // 设置同步状态图标
        if (iconElement) {
            iconElement.setAttribute('xlink:href', '#iconHistory');
        } else {
            console.warn('未找到插件图标元素，跳过图标状态更新');
        }

        try {
            const state = await api.URLsync(url, token);
            if (state) {
                console.log("docker感知成功");
            } else {
                showMessage("docker同步感知失败");
            }
        } catch (e) {
            showMessage("docker感知出现异常: " + e, -1, "error");
        } finally {
            // 无论成功失败都恢复图标
            if (iconElement) {
                if (originalIcon) {
                    iconElement.setAttribute('xlink:href', originalIcon);
                } else {
                    // 如果没有原始图标，移除xlink:href属性或设置默认图标
                    iconElement.removeAttribute('xlink:href');
                }
            }
        }
    }

    async testSync() {
        // console.log("测试同步...");
        let res: any = await api.testSync(url, token);
        console.log("res: ", res);
        if (res) {
            showMessage("成功");
        } else {
            showMessage("失败");
        }
    }

    // 新增：手动触发docker同步
    async manualDockerSync() {
        if (!this.dockerSyncEnabled) {
            showMessage("Docker感知同步未启用");
            return;
        }
        await this.handleDockerSync();
    }

    // 新增：手动触发滴答清单同步
    async manualDidaSync() {
        await this.didaSyncInstance.manualDidaSync();
    }

    // 新增：获取同步状态
    getSyncStatus() {
        return {
            dockerSyncEnabled: this.dockerSyncEnabled,
            mydidaSyncEnabled: this.didaSyncInstance["mydidaSyncEnabled"],
            autoTriggerEnabled: this.settingdata["docker-sync-auto-trigger-dida"]
        };
    }

    // 新增：手动测试 Dida 并获取对应项目的任务并显示
    async manualTestDidaProjectTasks() {
        if (!this.didaSyncInstance["mydidaSyncEnabled"]) {
            showMessage("滴答清单同步未启用");
            return;
        }

        try {
            // 假设 module-dida-sync.ts 中有获取项目任务的方法，这里命名为 getProjectTasks
            const projectId = this.settingdata["cal-dida-default-list-id"];
            const projectData = await this.didaSyncInstance.getProjectData(projectId);
            const tasks = projectData.tasks;

            if (tasks && tasks.length > 0) {
                const taskList = tasks.map(task => task.title).join('\n');
                showMessage(`获取到的项目任务：\n${taskList}`);
            } else {
                showMessage("未获取到项目任务");
            }
        } catch (error) {
            console.error("获取项目任务失败:", error);
            showMessage(`获取项目任务失败: ${error.message}`, -1, "error");
        }
    }
}
