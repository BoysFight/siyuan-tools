import steveTools from "@/index";
import * as api from "@/api"
import { showMessage } from "siyuan";
import { moduleInstances } from '@/index';
import { M_didaSync } from './module-dida-sync';

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
        steveTools.outlog("同步模块初始化中...");

        // 分别初始化docker感知和滴答清单同步
        await this.initDockerSync();
        await this.didaSyncInstance.init(settingdata);

        steveTools.outlog("同步模块初始化完成");
    }

    // 独立的docker感知同步初始化
    private async initDockerSync() {
        this.dockerSyncEnabled = this.settingdata["sync-enable"];
        if (this.dockerSyncEnabled) {
            url = this.settingdata["sync-url"]; // 兼容旧配置
            token = this.settingdata["sync-token"]; // 兼容旧配置
            this.setupDockerSyncListener();
            steveTools.outlog("Docker感知同步已启用");
        }
    }

    // 修改docker感知监听器，解耦合滴答清单同步
    private setupDockerSyncListener() {
        if (!this.dockerSyncEnabled) return;

        siyuan.ws.ws.addEventListener('message', async (e) => {
            const msg = JSON.parse(e.data);
            if (msg.cmd === "syncing") {
                if (msg.msg && msg.msg.startsWith('上传')) {
                    console.log("同步结束");
                    const currentHost = window.location.host;
                    if (url.includes(currentHost)) {
                        console.log("取消感知");
                    } else {
                        setTimeout(async () => {
                            await this.handleDockerSync();
                        }, 1000);
                    }
                }
                // 可选：docker同步后自动触发滴答清单同步
                if (this.settingdata["docker-sync-auto-trigger-dida"]) {
                    await this.didaSyncInstance.syncToDidaList();
                }
            }
        });
    }

    // 独立的docker同步处理方法
    private async handleDockerSync() {
        if (!this.dockerSyncEnabled) {
            console.log("Docker感知同步未启用");
            return;
        }

        try {
            let originalIcon = "";
            const iconElement = document.querySelector('#plugin_siyuan-steve-tools_0 svg use');
            if (iconElement) {
                originalIcon = iconElement.getAttribute('xlink:href');
                iconElement.setAttribute('xlink:href', '#iconHistory');
            }

            const state = await api.URLsync(url, token);
            if (state) {
                console.log("docker感知成功");
                if (originalIcon && iconElement) {
                    iconElement.setAttribute('xlink:href', originalIcon);
                }
            } else {
                showMessage("docker同步感知失败");
            }
        } catch (e) {
            showMessage("docker感知同步失败: " + e, -1, "error");
        }
    }

    async testSync() {
        steveTools.outlog("测试同步...");
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
            didaSyncEnabled: this.didaSyncInstance["didaSyncEnabled"],
            autoTriggerEnabled: this.settingdata["docker-sync-auto-trigger-dida"]
        };
    }

    // 新增：手动测试 Dida 并获取对应项目的任务并显示
    async manualTestDidaProjectTasks() {
        if (!this.didaSyncInstance["didaSyncEnabled"]) {
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
