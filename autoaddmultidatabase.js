// 功能：自动添加文档到多个数据库
// version 0.0.1

(async () => {
    let isProcessing = false; // 全局处理锁
    const processedNotes = new Set(); // 记录已处理的文档ID
    let addedCount = {}; // 记录每个数据库添加的文档数量

    // 配置多个数据库的规则
    const databaseRules = [
        {
            name: '项目文档数据库',
            dbBlockId: '20240918154915-8ktx2i4', // 数据库块ID
            notebookID: '20230323101042-0iji3w9', // 笔记本ID
            pathPattern: /^\/20240430105640-waf30sl\//i, // 文档路径匹配规则
            titlePattern: /^(Story|Epic|Feature)-/i // 文档标题匹配规则
        },
        {
            name: '文章数据库',
            dbBlockId: '20240915110837-quim9ts',
            notebookID: '20230322123651-tsuyuox',
            pathPattern: /^/i,
            titlePattern: null // 不需要标题匹配
        }
        // 可以添加更多数据库规则
    ];


    // 检查文档是否符合数据库规则
    const matchDatabaseRule = (notebookId, path, title) => {
        return databaseRules.find(rule => {
            const matchNotebook = rule.notebookID === notebookId;
            const matchPath = rule.pathPattern?.test(path) ?? true;
            const matchTitle = rule.titlePattern ? rule.titlePattern.test(title) : true;
            return matchNotebook && matchPath && matchTitle;
        });
    };


    // 1. 劫持fetch监听文档创建
    // 定义支持的API及其处理逻辑
    // 从路径中提取文档ID
    const extractDocId = (path) => {
        const match = path.match(/\d{14}-[a-z0-9]{7}(?=\.sy$)/);
        return match ? match[0] : null;
    };

    // 统一处理文档添加的延迟逻辑
    const scheduleDocProcess = (docId, delay = 0) => {
        if (!docId) return;
        setTimeout(() => handleDocAdded(docId), delay);
    };

    const API_HANDLERS = {
        '/api/filetree/renameDoc': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    return matchDatabaseRule(params.notebook, params.path, params.title);
                } catch (err) {
                    console.error('解析请求参数失败:', err);
                    return false;
                }
            },
            getDocId: (result, options) => {
                try {
                    const params = JSON.parse(options.body);
                    return extractDocId(params.path);
                } catch (err) {
                    console.error('从路径提取文档ID失败:', err);
                    return null;
                }
            }
        },
        '/api/filetree/listDocsByPath': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    return matchDatabaseRule(params.notebook, params.path, '');
                } catch (err) {
                    console.error('解析请求参数失败:', err);
                    return false;
                }
            },
            getDocId: result => {
                if (!result.data?.files?.length) {
                    console.log('未找到需要处理的文档');
                    return null;
                }
                // 获取所有文档ID
                const docIds = result.data.files.map(file => file.id);
                console.log(`找到 ${docIds.length} 个文档待处理`);
                // 异步处理每个文档
                docIds.forEach((id, index) => scheduleDocProcess(id, index * 100));
                // 返回 null 避免重复处理
                return null;
            }
        }
    };

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const [url, options] = args;

        // console.log(`window.fetch ${url}...`);
        // 检查是否为支持的API
        const handler = API_HANDLERS[url];
        if (handler && options?.method === handler.method) {
            // 如果有参数验证逻辑，先验证参数
            if (handler.validateParams && !handler.validateParams(options?.body)) {
                return originalFetch.apply(this, args);
            }
            const response = await originalFetch.apply(this, args);
            const result = await response.clone().json();

            // 异步处理数据库添加（不阻塞原始请求）
            try {
                const docId = handler.getDocId(result, options);
                if (!docId) {
                    console.error('无法从响应中获取文档ID:', { url, result });
                    return response;
                }

                console.log(`开始处理文档 ${docId}...`);
                scheduleDocProcess(docId);
            } catch (err) {
                console.error('处理文档创建响应时出错:', err);
            }

            return response;
        }
        return originalFetch.apply(this, args);
    };

    // 2. 实际处理函数
    async function handleDocAdded(docId) {
        if (isProcessing || processedNotes.has(docId)) return;

        isProcessing = true;
        try {
            console.log(`开始处理文档 ${docId}...`);

            // 获取文档信息
            const docInfo = await getDataBySql(`SELECT * FROM blocks WHERE id='${docId}'`);
            if (!docInfo || docInfo.length === 0) {
                console.error('文档不存在');
                return;
            }

            const doc = docInfo[0];
            const boxid = doc.box;
            const path = doc.path;
            const title = doc.content;

            // 使用统一的规则匹配函数
            const matchedRule = matchDatabaseRule(boxid, path, title);
            if (matchedRule) {
                // 使用匹配到的规则处理文档
                console.log(`文档 ${docId} 匹配 ${matchedRule.name} 规则，开始处理`);
                // 后续使用 matchedRule 处理文档
            } else {
                console.log(`文档 ${docId} 不匹配任何规则：
                    - 笔记本：${boxid}
                    - 路径：${path}
                    - 标题：${title}
                    - 可用规则：${databaseRules.map(r => r.name).join(', ')}`);
                return;
            }

                // 获取数据库信息
                const db = await getDataBySql(`SELECT * FROM blocks WHERE type='av' AND id='${matchedRule.dbBlockId}'`);
                if (db.length === 0) {
                    console.error(`${matchedRule.name} 数据库文档块未找到`);
                    return;
                }

                const avID = db.map(av => getDataAvIdFromHtml(av.markdown))[0];

                // 检查是否已存在
                const isInResult = await fetchSyncPost("/api/av/getAttributeViewKeys", { id: docId });
                if (isInResult.data.some(item => item.avID === avID)) {
                    console.log(`文档已存在于 ${matchedRule.name} 中`);
                    return;
                }

                // 添加到数据库
                try {
                    await fetchSyncPost('/api/av/addAttributeViewBlocks', {
                        avID: avID,
                        srcs: [{ id: docId, isDetached: false }]
                    });
                    addedCount[matchedRule.name] = (addedCount[matchedRule.name] || 0) + 1;
                    processedNotes.add(docId);
                    console.log(`成功添加文档 ${docId} 到 ${matchedRule.name}`);
                } catch (err) {
                    console.error(`添加文档到 ${matchedRule.name} 失败:`, err);
                }
        } catch (error) {
            console.error('处理失败:', error);
        } finally {
            isProcessing = false;
        }
    }

    // 3. 工具函数
    function getDataAvIdFromHtml(htmlString) {
        const match = htmlString.match(/data-av-id="([^"]+)"/);        return match?.[1] || "";
    }

    async function getDataBySql(sql) {
        const result = await fetchSyncPost('/api/query/sql', { stmt: sql });
        return result.code === 0 ? result.data : [];
    }

    async function fetchSyncPost(url, data) {
        try {
            const res = await fetch(url, {
                method: "POST",
                body: JSON.stringify(data)
            });
            return await res.json();
        } catch (e) {
            console.error('API请求失败:', e);
            return { code: 1, data: null };
        }
    }
})();