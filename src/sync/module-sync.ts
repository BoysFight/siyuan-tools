import steveTools from "@/index";
import * as api from "@/api"
import { showMessage } from "siyuan";
import { Dida } from "@/calendar/share/dida"; // 添加滴答清单客户端导入
import * as myF from "@/calendar/myF"; // 添加 myF 导入
declare const siyuan: any;

import { moduleInstances } from '@/index';
import { TickTickOfficialClient, TickTickTask } from './ticktick-official-client';

let url = "";
let token = "";

//TODO: 目前只能单向感知，即只能docker端感知到本地端的变化，不能本地端感知到docker端的变化
export class M_sync {
    private plugin: steveTools;
    private settingdata: any;
    private officialClient?: TickTickOfficialClient;

    constructor(plugin: steveTools) {
        this.plugin = plugin;
    }

    init = async (settingdata) => {
        this.settingdata = settingdata;
        steveTools.outlog("同步模块初始化中...");
        url = settingdata["sync-url"];
        token = settingdata["sync-token"];
        
        // 设置docker感知同步监听
        this.setupDockerSyncListener();
        
        steveTools.outlog("同步模块初始化完成");
    }

    // 新增：docker感知同步功能
    private setupDockerSyncListener() {
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
                            // 检测到同步事件后调用滴答清单同步
                            if (this.settingdata["cal-dida-auto-sync"]) {
                                await this.syncToDidaList();
                            }
                        }, 1000);
                    }
                }
            }
        });
    }

    // 新增：处理docker同步
    private async handleDockerSync() {
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
                if (originalIcon) {
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

    async syncToDidaList() {
        try {
            // 检查日历模块是否已加载
            if (!moduleInstances['M_calendar']) {
                throw new Error("日历模块未启用，请先在设置中启用日程管理功能");
            }

            // 1. 获取数据库视图ID
            const avIds = await moduleInstances['M_calendar'].getAVreferenceid();
            const viewIDs = await myF.getViewId(avIds);
            const viewValue = await myF.getViewValue(viewIDs);

            // 3. 遍历所有事件组
            for (const eventGroup of viewValue) {
                if (!eventGroup.data) continue;

                // 4. 遍历每个事件
                for (const event of eventGroup.data) {
                    const blockId = event?.事件?.id;
                    if (!blockId) continue;

                    const status = event?.状态?.content;

                // 计算优先级
                    let priority = 0;
                    if (event.优先级) {
                        switch (event?.优先级?.content.toLowerCase()) {
                            case 'high':
                            case '高':
                                priority = 5;
                                break;
                            case 'medium':
                            case '中':
                                priority = 3;
                                break;
                            case 'low':
                            case '低':
                                priority = 1;
                                break;
                            default:
                                priority = 0;
                        }
                    }

                    // 计算当前事件的hash值
                    const currentHash = this.calculateEventHash(event, priority, status);

                    const attrs = await api.getBlockAttrs(blockId);
                    const previousHash = attrs["custom-event-hash"];
                    const didaTaskId = attrs["custom-dida-taskid"];

                    // 如果hash值相同且已有任务ID，跳过更新
                    if (didaTaskId && previousHash === currentHash) {
                        console.log(`事件 ${event?.事件?.content} 无变化，跳过同步`);
                        continue;
                    }

                    const taskData = {
                        title: event?.事件?.content || "未命名任务",
                        content: event?.描述?.content || "",
                        projectId: this.settingdata["cal-dida-default-list-id"],
                        startDate: this.formatDateToISO(event?.开始时间?.start),
                        dueDate: this.formatDateToISO(event?.开始时间?.end),
                        status: status === "完成" ? 2 : 0,
                        priority: priority
                    };

                    // 在任务更新逻辑中添加完成状态处理
                    if (!didaTaskId) {
                        // 创建新任务
                    const result = await this.createTaskUnified(taskData);

                    // 获取新任务ID（处理不同API返回格式）
                        let newTaskId;
                    if (this.settingdata["cal-dida-use-official-api"]) {
                        newTaskId = result.id;
                    } else {
                        // 非官方API的ID获取逻辑
                        if (result.id2etag && Object.keys(result.id2etag).length > 0) {
                            newTaskId = Object.keys(result.id2etag)[0];
                        } else if (result.add && result.add.length > 0) {
                            newTaskId = result.add[0].id;
                        }
                    }

                        if (newTaskId) {
                            await api.setBlockAttrs(blockId, {
                                "custom-dida-taskid": newTaskId,
                                "custom-event-hash": currentHash
                            });
                        }
                    } else {
                        // 更新任务
                    await this.updateTaskUnified(didaTaskId, taskData);

                        // 更新hash值
                        await api.setBlockAttrs(blockId, {
                            "custom-event-hash": currentHash
                        });
                    }
                }

            }
            showMessage("同步到滴答清单成功");

        } catch (error) {
            console.error("同步失败:", error);
            showMessage(`同步失败: ${error.message}`);
        }
    }

    // 添加日期格式化方法
    private formatDateToISO(dateInput: any): string | undefined {
        if (!dateInput) return undefined;

        let date: Date;

        // 处理不同类型的日期输入
        if (dateInput instanceof Date) {
            date = dateInput;
        } else if (typeof dateInput === 'string') {
            date = new Date(dateInput);
        } else if (typeof dateInput === 'number') {
            date = new Date(dateInput);
        } else {
            return undefined;
        }

        // 检查日期是否有效
        if (isNaN(date.getTime())) {
            return undefined;
        }

        // 转换为 ISO 格式并替换时区为 +0000
        return date.toISOString().replace('Z', '+0000');
    }

    // 添加计算事件hash值的方法
    private calculateEventHash(event: any, priority: number, status: string): string {
        const hashData = {
            title: event?.事件?.content || "",
            priority: priority,
            startDate: event?.开始时间?.start,
            endDate: event?.开始时间?.end,
            content: event?.描述?.content || "",
            status: status
        };

        const str = JSON.stringify(hashData);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // 统一的任务创建接口
    private async createTaskUnified(taskData: any): Promise<any> {
        if (this.settingdata["cal-dida-use-official-api"]) {
            if (!this.officialClient) {
                // 初始化官方客户端
                this.officialClient = new TickTickOfficialClient({
                    clientId: this.settingdata["cal-dida-official-client-id"] || "",
                    clientSecret: this.settingdata["cal-dida-official-client-secret"] || "",
                    accessToken: this.settingdata["cal-dida-official-access-token"] || undefined,
                    refreshToken: this.settingdata["cal-dida-official-refresh-token"] || undefined
                });
                // 如果设置了access token，直接使用，不走refresh流程
                if (this.settingdata["cal-dida-official-access-token"]) {
                    this.officialClient.setAccessToken(this.settingdata["cal-dida-official-access-token"]);
                }
            }
            const officialTask: TickTickTask = {
                title: taskData.title,
                content: taskData.content,
                projectId: taskData.projectId,
                startDate: taskData.startDate,
                dueDate: taskData.dueDate,
                priority: taskData.priority,
                status: taskData.status
            };
            return await this.officialClient.createTask(officialTask);
        } else {
            // 使用非官方API
            const dida = new Dida({
                username: this.settingdata["cal-dida-username"],
                password: this.settingdata["cal-dida-password"]
            });
            const res = await dida.create(taskData);
            return await res.json();
        }
    }

    // 统一的任务更新接口
    private async updateTaskUnified(taskId: string, taskData: any): Promise<any> {
        if (this.settingdata["cal-dida-use-official-api"]) {
            if (!this.officialClient) {
                // 初始化官方客户端
                this.officialClient = new TickTickOfficialClient({
                    clientId: this.settingdata["cal-dida-official-client-id"] || "",
                    clientSecret: this.settingdata["cal-dida-official-client-secret"] || "",
                    accessToken: this.settingdata["cal-dida-official-access-token"] || undefined,
                    refreshToken: this.settingdata["cal-dida-official-refresh-token"] || undefined
                });
                // 如果设置了access token，直接使用，不走refresh流程
                if (this.settingdata["cal-dida-official-access-token"]) {
                    this.officialClient.setAccessToken(this.settingdata["cal-dida-official-access-token"]);
                }
            }
            // 使用官方API
            const officialTask: Partial<TickTickTask> = {
                title: taskData.title,
                content: taskData.content,
                projectId: taskData.projectId,
                startDate: taskData.startDate,
                dueDate: taskData.dueDate,
                priority: taskData.priority,
                status: taskData.status
            };
            return await this.officialClient.updateTask(taskId, officialTask);
        } else {
            // 使用非官方API
            const dida = new Dida({
                username: this.settingdata["cal-dida-username"],
                password: this.settingdata["cal-dida-password"]
            });
            return await dida.update({
                id: taskId,
                ...taskData
            });
        }
    }

}
