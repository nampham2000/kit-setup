"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeTools = void 0;
const component_tools_1 = require("./component-tools");
class NodeTools {
    constructor() {
        this.componentTools = new component_tools_1.ComponentTools();
    }
    getTools() {
        return [
            {
                name: 'create_node',
                description: 'Create a new node in the scene. Supports creating empty nodes, nodes with components, or instantiating from assets (prefabs, etc.). IMPORTANT: You should always provide parentUuid to specify where to create the node.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Node name'
                        },
                        parentUuid: {
                            type: 'string',
                            description: 'Parent node UUID. STRONGLY RECOMMENDED: Always provide this parameter. Use get_current_scene or get_all_nodes to find parent UUIDs. If not provided, node will be created at scene root.'
                        },
                        nodeType: {
                            type: 'string',
                            description: 'Node type: Node, 2DNode, 3DNode',
                            enum: ['Node', '2DNode', '3DNode'],
                            default: 'Node'
                        },
                        siblingIndex: {
                            type: 'number',
                            description: 'Sibling index for ordering (-1 means append at end)',
                            default: -1
                        },
                        assetUuid: {
                            type: 'string',
                            description: 'Asset UUID to instantiate from (e.g., prefab UUID). When provided, creates a node instance from the asset instead of an empty node.'
                        },
                        assetPath: {
                            type: 'string',
                            description: 'Asset path to instantiate from (e.g., "db://assets/prefabs/MyPrefab.prefab"). Alternative to assetUuid.'
                        },
                        components: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Array of component type names to add to the new node (e.g., ["cc.Sprite", "cc.Button"])'
                        },
                        unlinkPrefab: {
                            type: 'boolean',
                            description: 'If true and creating from prefab, unlink from prefab to create a regular node',
                            default: false
                        },
                        keepWorldTransform: {
                            type: 'boolean',
                            description: 'Whether to keep world transform when creating the node',
                            default: false
                        },
                        initialTransform: {
                            type: 'object',
                            properties: {
                                position: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                        z: { type: 'number' }
                                    }
                                },
                                rotation: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                        z: { type: 'number' }
                                    }
                                },
                                scale: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                        z: { type: 'number' }
                                    }
                                }
                            },
                            description: 'Initial transform to apply to the created node'
                        }
                    },
                    required: ['name']
                }
            },
            {
                name: 'get_node_info',
                description: 'Get node information by UUID',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        }
                    },
                    required: ['uuid']
                }
            },
            {
                name: 'find_nodes',
                description: 'Find nodes by name pattern',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pattern: {
                            type: 'string',
                            description: 'Name pattern to search'
                        },
                        exactMatch: {
                            type: 'boolean',
                            description: 'Exact match or partial match',
                            default: false
                        }
                    },
                    required: ['pattern']
                }
            },
            {
                name: 'find_node_by_name',
                description: 'Find first node by exact name',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Node name to find'
                        }
                    },
                    required: ['name']
                }
            },
            {
                name: 'get_all_nodes',
                description: 'Get all nodes in the scene with their UUIDs',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'set_node_property',
                description: 'Set node property value (prefer using set_node_transform for active/layer/mobility/position/rotation/scale)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        property: {
                            type: 'string',
                            description: 'Property name (e.g., active, name, layer)'
                        },
                        value: {
                            description: 'Property value'
                        }
                    },
                    required: ['uuid', 'property', 'value']
                }
            },
            {
                name: 'set_node_transform',
                description: 'Set node transform properties (position, rotation, scale) with unified interface. Automatically handles 2D/3D node differences.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        position: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number', description: 'Z coordinate (ignored for 2D nodes)' }
                            },
                            description: 'Node position. For 2D nodes, only x,y are used; z is ignored. For 3D nodes, all coordinates are used.'
                        },
                        rotation: {
                            type: 'object',
                            properties: {
                                x: { type: 'number', description: 'X rotation (ignored for 2D nodes)' },
                                y: { type: 'number', description: 'Y rotation (ignored for 2D nodes)' },
                                z: { type: 'number', description: 'Z rotation (main rotation axis for 2D nodes)' }
                            },
                            description: 'Node rotation in euler angles. For 2D nodes, only z rotation is used. For 3D nodes, all axes are used.'
                        },
                        scale: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number', description: 'Z scale (usually 1 for 2D nodes)' }
                            },
                            description: 'Node scale. For 2D nodes, z is typically 1. For 3D nodes, all axes are used.'
                        }
                    },
                    required: ['uuid']
                }
            },
            {
                name: 'delete_node',
                description: 'Delete a node from scene',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID to delete'
                        }
                    },
                    required: ['uuid']
                }
            },
            {
                name: 'move_node',
                description: 'Move node to new parent',
                inputSchema: {
                    type: 'object',
                    properties: {
                        nodeUuid: {
                            type: 'string',
                            description: 'Node UUID to move'
                        },
                        newParentUuid: {
                            type: 'string',
                            description: 'New parent node UUID'
                        },
                        siblingIndex: {
                            type: 'number',
                            description: 'Sibling index in new parent',
                            default: -1
                        }
                    },
                    required: ['nodeUuid', 'newParentUuid']
                }
            },
            {
                name: 'duplicate_node',
                description: 'Duplicate a node',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID to duplicate'
                        },
                        includeChildren: {
                            type: 'boolean',
                            description: 'Include children nodes',
                            default: true
                        }
                    },
                    required: ['uuid']
                }
            },
            {
                name: 'detect_node_type',
                description: 'Detect if a node is 2D or 3D based on its components and properties',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID to analyze'
                        }
                    },
                    required: ['uuid']
                }
            }
        ];
    }
    async execute(toolName, args) {
        switch (toolName) {
            case 'create_node':
                return await this.createNode(args);
            case 'get_node_info':
                return await this.getNodeInfo(args.uuid);
            case 'find_nodes':
                return await this.findNodes(args.pattern, args.exactMatch);
            case 'find_node_by_name':
                return await this.findNodeByName(args.name);
            case 'get_all_nodes':
                return await this.getAllNodes();
            case 'set_node_property':
                return await this.setNodeProperty(args.uuid, args.property, args.value);
            case 'set_node_transform':
                return await this.setNodeTransform(args);
            case 'delete_node':
                return await this.deleteNode(args.uuid);
            case 'move_node':
                return await this.moveNode(args.nodeUuid, args.newParentUuid, args.siblingIndex);
            case 'duplicate_node':
                return await this.duplicateNode(args.uuid, args.includeChildren);
            case 'detect_node_type':
                return await this.detectNodeType(args.uuid);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
    async createNode(args) {
        return new Promise(async (resolve) => {
            try {
                let targetParentUuid = args.parentUuid;
                // If no parent node UUID is provided, get the scene root node
                if (!targetParentUuid) {
                    try {
                        const sceneInfo = await Editor.Message.request('scene', 'query-node-tree');
                        if (sceneInfo && typeof sceneInfo === 'object' && !Array.isArray(sceneInfo) && Object.prototype.hasOwnProperty.call(sceneInfo, 'uuid')) {
                            targetParentUuid = sceneInfo.uuid;
                            console.log(`No parent specified, using scene root: ${targetParentUuid}`);
                        }
                        else if (Array.isArray(sceneInfo) && sceneInfo.length > 0 && sceneInfo[0].uuid) {
                            targetParentUuid = sceneInfo[0].uuid;
                            console.log(`No parent specified, using scene root: ${targetParentUuid}`);
                        }
                        else {
                            const currentScene = await Editor.Message.request('scene', 'query-current-scene');
                            if (currentScene && currentScene.uuid) {
                                targetParentUuid = currentScene.uuid;
                            }
                        }
                    }
                    catch (err) {
                        console.warn('Failed to get scene root, will use default behavior');
                    }
                }
                // If assetPath is provided, resolve it to assetUuid first
                let finalAssetUuid = args.assetUuid;
                if (args.assetPath && !finalAssetUuid) {
                    try {
                        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', args.assetPath);
                        if (assetInfo && assetInfo.uuid) {
                            finalAssetUuid = assetInfo.uuid;
                            console.log(`Asset path '${args.assetPath}' resolved to UUID: ${finalAssetUuid}`);
                        }
                        else {
                            resolve({
                                success: false,
                                error: `Asset not found at path: ${args.assetPath}`
                            });
                            return;
                        }
                    }
                    catch (err) {
                        resolve({
                            success: false,
                            error: `Failed to resolve asset path '${args.assetPath}': ${err}`
                        });
                        return;
                    }
                }
                // Build create-node options
                const createNodeOptions = {
                    name: args.name
                };
                // Set the parent node
                if (targetParentUuid) {
                    createNodeOptions.parent = targetParentUuid;
                }
                // Instantiate from an asset
                if (finalAssetUuid) {
                    createNodeOptions.assetUuid = finalAssetUuid;
                    if (args.unlinkPrefab) {
                        createNodeOptions.unlinkPrefab = true;
                    }
                }
                // Add components
                if (args.components && args.components.length > 0) {
                    createNodeOptions.components = args.components;
                }
                else if (args.nodeType && args.nodeType !== 'Node' && !finalAssetUuid) {
                    // Add the nodeType component only when not instantiating from an asset
                    createNodeOptions.components = [args.nodeType];
                }
                // Keep the world transform
                if (args.keepWorldTransform) {
                    createNodeOptions.keepWorldTransform = true;
                }
                // Do not use dump parameters for the initial transform; set it with set_node_transform after creation
                console.log('Creating node with options:', createNodeOptions);
                // Create the node
                const nodeUuid = await Editor.Message.request('scene', 'create-node', createNodeOptions);
                const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid;
                // Handle the sibling index
                if (args.siblingIndex !== undefined && args.siblingIndex >= 0 && uuid && targetParentUuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for the internal state to update
                        await Editor.Message.request('scene', 'set-parent', {
                            parent: targetParentUuid,
                            uuids: [uuid],
                            keepWorldTransform: args.keepWorldTransform || false
                        });
                    }
                    catch (err) {
                        console.warn('Failed to set sibling index:', err);
                    }
                }
                // Add components if they were provided
                if (args.components && args.components.length > 0 && uuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for node creation to finish
                        for (const componentType of args.components) {
                            try {
                                const result = await this.componentTools.execute('add_component', {
                                    nodeUuid: uuid,
                                    componentType: componentType
                                });
                                if (result.success) {
                                    console.log(`Component ${componentType} added successfully`);
                                }
                                else {
                                    console.warn(`Failed to add component ${componentType}:`, result.error);
                                }
                            }
                            catch (err) {
                                console.warn(`Failed to add component ${componentType}:`, err);
                            }
                        }
                    }
                    catch (err) {
                        console.warn('Failed to add components:', err);
                    }
                }
                // Set the initial transform if it was provided
                if (args.initialTransform && uuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 150)); // Wait for node and component creation to finish
                        await this.setNodeTransform({
                            uuid: uuid,
                            position: args.initialTransform.position,
                            rotation: args.initialTransform.rotation,
                            scale: args.initialTransform.scale
                        });
                        console.log('Initial transform applied successfully');
                    }
                    catch (err) {
                        console.warn('Failed to set initial transform:', err);
                    }
                }
                // Get the created node information for verification
                let verificationData = null;
                try {
                    const nodeInfo = await this.getNodeInfo(uuid);
                    if (nodeInfo.success) {
                        verificationData = {
                            nodeInfo: nodeInfo.data,
                            creationDetails: {
                                parentUuid: targetParentUuid,
                                nodeType: args.nodeType || 'Node',
                                fromAsset: !!finalAssetUuid,
                                assetUuid: finalAssetUuid,
                                assetPath: args.assetPath,
                                timestamp: new Date().toISOString()
                            }
                        };
                    }
                }
                catch (err) {
                    console.warn('Failed to get verification data:', err);
                }
                const successMessage = finalAssetUuid
                    ? `Node '${args.name}' instantiated from asset successfully`
                    : `Node '${args.name}' created successfully`;
                resolve({
                    success: true,
                    data: {
                        uuid: uuid,
                        name: args.name,
                        parentUuid: targetParentUuid,
                        nodeType: args.nodeType || 'Node',
                        fromAsset: !!finalAssetUuid,
                        assetUuid: finalAssetUuid,
                        message: successMessage
                    },
                    verificationData: verificationData
                });
            }
            catch (err) {
                resolve({
                    success: false,
                    error: `Failed to create node: ${err.message}. Args: ${JSON.stringify(args)}`
                });
            }
        });
    }
    async getNodeInfo(uuid) {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node', uuid).then((nodeData) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                if (!nodeData) {
                    resolve({
                        success: false,
                        error: 'Node not found or invalid response'
                    });
                    return;
                }
                // Parse node information based on the actual returned data structure
                const info = {
                    uuid: ((_a = nodeData.uuid) === null || _a === void 0 ? void 0 : _a.value) || uuid,
                    name: ((_b = nodeData.name) === null || _b === void 0 ? void 0 : _b.value) || 'Unknown',
                    active: ((_c = nodeData.active) === null || _c === void 0 ? void 0 : _c.value) !== undefined ? nodeData.active.value : true,
                    position: ((_d = nodeData.position) === null || _d === void 0 ? void 0 : _d.value) || { x: 0, y: 0, z: 0 },
                    rotation: ((_e = nodeData.rotation) === null || _e === void 0 ? void 0 : _e.value) || { x: 0, y: 0, z: 0 },
                    scale: ((_f = nodeData.scale) === null || _f === void 0 ? void 0 : _f.value) || { x: 1, y: 1, z: 1 },
                    parent: ((_h = (_g = nodeData.parent) === null || _g === void 0 ? void 0 : _g.value) === null || _h === void 0 ? void 0 : _h.uuid) || null,
                    children: nodeData.children || [],
                    components: (nodeData.__comps__ || []).map((comp) => ({
                        type: comp.__type__ || 'Unknown',
                        enabled: comp.enabled !== undefined ? comp.enabled : true
                    })),
                    layer: ((_j = nodeData.layer) === null || _j === void 0 ? void 0 : _j.value) || 1073741824,
                    mobility: ((_k = nodeData.mobility) === null || _k === void 0 ? void 0 : _k.value) || 0
                };
                resolve({ success: true, data: info });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async findNodes(pattern, exactMatch = false) {
        return new Promise((resolve) => {
            // Note: 'query-nodes-by-name' API doesn't exist in official documentation
            // Using tree traversal as primary approach
            Editor.Message.request('scene', 'query-node-tree').then((tree) => {
                const nodes = [];
                const searchTree = (node, currentPath = '') => {
                    const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
                    const matches = exactMatch ?
                        node.name === pattern :
                        node.name.toLowerCase().includes(pattern.toLowerCase());
                    if (matches) {
                        nodes.push({
                            uuid: node.uuid,
                            name: node.name,
                            path: nodePath
                        });
                    }
                    if (node.children) {
                        for (const child of node.children) {
                            searchTree(child, nodePath);
                        }
                    }
                };
                if (tree) {
                    searchTree(tree);
                }
                resolve({ success: true, data: nodes });
            }).catch((err) => {
                // Fallback: use the scene script
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'findNodes',
                    args: [pattern, exactMatch]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
                    resolve(result);
                }).catch((err2) => {
                    resolve({ success: false, error: `Tree search failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }
    async findNodeByName(name) {
        return new Promise((resolve) => {
            // Prefer querying and searching the node tree through the Editor API
            Editor.Message.request('scene', 'query-node-tree').then((tree) => {
                const foundNode = this.searchNodeInTree(tree, name);
                if (foundNode) {
                    resolve({
                        success: true,
                        data: {
                            uuid: foundNode.uuid,
                            name: foundNode.name,
                            path: this.getNodePath(foundNode)
                        }
                    });
                }
                else {
                    resolve({ success: false, error: `Node '${name}' not found` });
                }
            }).catch((err) => {
                // Fallback: use the scene script
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'findNodeByName',
                    args: [name]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
                    resolve(result);
                }).catch((err2) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }
    searchNodeInTree(node, targetName) {
        if (node.name === targetName) {
            return node;
        }
        if (node.children) {
            for (const child of node.children) {
                const found = this.searchNodeInTree(child, targetName);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }
    async getAllNodes() {
        return new Promise((resolve) => {
            // Try querying the scene node tree
            Editor.Message.request('scene', 'query-node-tree').then((tree) => {
                const nodes = [];
                const traverseTree = (node) => {
                    nodes.push({
                        uuid: node.uuid,
                        name: node.name,
                        type: node.type,
                        active: node.active,
                        path: this.getNodePath(node)
                    });
                    if (node.children) {
                        for (const child of node.children) {
                            traverseTree(child);
                        }
                    }
                };
                if (tree && tree.children) {
                    traverseTree(tree);
                }
                resolve({
                    success: true,
                    data: {
                        totalNodes: nodes.length,
                        nodes: nodes
                    }
                });
            }).catch((err) => {
                // Fallback: use the scene script
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getAllNodes',
                    args: []
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
                    resolve(result);
                }).catch((err2) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }
    getNodePath(node) {
        const path = [node.name];
        let current = node.parent;
        while (current && current.name !== 'Canvas') {
            path.unshift(current.name);
            current = current.parent;
        }
        return path.join('/');
    }
    async setNodeProperty(uuid, property, value) {
        return new Promise((resolve) => {
            // Try setting the node property directly through the Editor API
            Editor.Message.request('scene', 'set-property', {
                uuid: uuid,
                path: property,
                dump: {
                    value: value
                }
            }).then(() => {
                // Get comprehensive verification data including updated node info
                this.getNodeInfo(uuid).then((nodeInfo) => {
                    resolve({
                        success: true,
                        message: `Property '${property}' updated successfully`,
                        data: {
                            nodeUuid: uuid,
                            property: property,
                            newValue: value
                        },
                        verificationData: {
                            nodeInfo: nodeInfo.data,
                            changeDetails: {
                                property: property,
                                value: value,
                                timestamp: new Date().toISOString()
                            }
                        }
                    });
                }).catch(() => {
                    resolve({
                        success: true,
                        message: `Property '${property}' updated successfully (verification failed)`
                    });
                });
            }).catch((err) => {
                // If direct assignment fails, try using the scene script
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'setNodeProperty',
                    args: [uuid, property, value]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
                    resolve(result);
                }).catch((err2) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }
    async setNodeTransform(args) {
        return new Promise(async (resolve) => {
            const { uuid, position, rotation, scale } = args;
            const updatePromises = [];
            const updates = [];
            const warnings = [];
            try {
                // First get node info to determine if it's 2D or 3D
                const nodeInfoResponse = await this.getNodeInfo(uuid);
                if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
                    resolve({ success: false, error: 'Failed to get node information' });
                    return;
                }
                const nodeInfo = nodeInfoResponse.data;
                const is2DNode = this.is2DNode(nodeInfo);
                if (position) {
                    const normalizedPosition = this.normalizeTransformValue(position, 'position', is2DNode);
                    if (normalizedPosition.warning) {
                        warnings.push(normalizedPosition.warning);
                    }
                    updatePromises.push(Editor.Message.request('scene', 'set-property', {
                        uuid: uuid,
                        path: 'position',
                        dump: { value: normalizedPosition.value }
                    }));
                    updates.push('position');
                }
                if (rotation) {
                    const normalizedRotation = this.normalizeTransformValue(rotation, 'rotation', is2DNode);
                    if (normalizedRotation.warning) {
                        warnings.push(normalizedRotation.warning);
                    }
                    updatePromises.push(Editor.Message.request('scene', 'set-property', {
                        uuid: uuid,
                        path: 'rotation',
                        dump: { value: normalizedRotation.value }
                    }));
                    updates.push('rotation');
                }
                if (scale) {
                    const normalizedScale = this.normalizeTransformValue(scale, 'scale', is2DNode);
                    if (normalizedScale.warning) {
                        warnings.push(normalizedScale.warning);
                    }
                    updatePromises.push(Editor.Message.request('scene', 'set-property', {
                        uuid: uuid,
                        path: 'scale',
                        dump: { value: normalizedScale.value }
                    }));
                    updates.push('scale');
                }
                if (updatePromises.length === 0) {
                    resolve({ success: false, error: 'No transform properties specified' });
                    return;
                }
                await Promise.all(updatePromises);
                // Verify the changes by getting updated node info
                const updatedNodeInfo = await this.getNodeInfo(uuid);
                const response = {
                    success: true,
                    message: `Transform properties updated: ${updates.join(', ')} ${is2DNode ? '(2D node)' : '(3D node)'}`,
                    updatedProperties: updates,
                    data: {
                        nodeUuid: uuid,
                        nodeType: is2DNode ? '2D' : '3D',
                        appliedChanges: updates,
                        transformConstraints: {
                            position: is2DNode ? 'x, y only (z ignored)' : 'x, y, z all used',
                            rotation: is2DNode ? 'z only (x, y ignored)' : 'x, y, z all used',
                            scale: is2DNode ? 'x, y main, z typically 1' : 'x, y, z all used'
                        }
                    },
                    verificationData: {
                        nodeInfo: updatedNodeInfo.data,
                        transformDetails: {
                            originalNodeType: is2DNode ? '2D' : '3D',
                            appliedTransforms: updates,
                            timestamp: new Date().toISOString()
                        },
                        beforeAfterComparison: {
                            before: nodeInfo,
                            after: updatedNodeInfo.data
                        }
                    }
                };
                if (warnings.length > 0) {
                    response.warning = warnings.join('; ');
                }
                resolve(response);
            }
            catch (err) {
                resolve({
                    success: false,
                    error: `Failed to update transform: ${err.message}`
                });
            }
        });
    }
    is2DNode(nodeInfo) {
        // Check if node has 2D-specific components or is under Canvas
        const components = nodeInfo.components || [];
        // Check for common 2D components
        const has2DComponents = components.some((comp) => comp.type && (comp.type.includes('cc.Sprite') ||
            comp.type.includes('cc.Label') ||
            comp.type.includes('cc.Button') ||
            comp.type.includes('cc.Layout') ||
            comp.type.includes('cc.Widget') ||
            comp.type.includes('cc.Mask') ||
            comp.type.includes('cc.Graphics')));
        if (has2DComponents) {
            return true;
        }
        // Check for 3D-specific components  
        const has3DComponents = components.some((comp) => comp.type && (comp.type.includes('cc.MeshRenderer') ||
            comp.type.includes('cc.Camera') ||
            comp.type.includes('cc.Light') ||
            comp.type.includes('cc.DirectionalLight') ||
            comp.type.includes('cc.PointLight') ||
            comp.type.includes('cc.SpotLight')));
        if (has3DComponents) {
            return false;
        }
        // Default heuristic: if z position is 0 and hasn't been changed, likely 2D
        const position = nodeInfo.position;
        if (position && Math.abs(position.z) < 0.001) {
            return true;
        }
        // Default to 3D if uncertain
        return false;
    }
    normalizeTransformValue(value, type, is2D) {
        const result = Object.assign({}, value);
        let warning;
        if (is2D) {
            switch (type) {
                case 'position':
                    if (value.z !== undefined && Math.abs(value.z) > 0.001) {
                        warning = `2D node: z position (${value.z}) ignored, set to 0`;
                        result.z = 0;
                    }
                    else if (value.z === undefined) {
                        result.z = 0;
                    }
                    break;
                case 'rotation':
                    if ((value.x !== undefined && Math.abs(value.x) > 0.001) ||
                        (value.y !== undefined && Math.abs(value.y) > 0.001)) {
                        warning = `2D node: x,y rotations ignored, only z rotation applied`;
                        result.x = 0;
                        result.y = 0;
                    }
                    else {
                        result.x = result.x || 0;
                        result.y = result.y || 0;
                    }
                    result.z = result.z || 0;
                    break;
                case 'scale':
                    if (value.z === undefined) {
                        result.z = 1; // Default scale for 2D
                    }
                    break;
            }
        }
        else {
            // 3D node - ensure all axes are defined
            result.x = result.x !== undefined ? result.x : (type === 'scale' ? 1 : 0);
            result.y = result.y !== undefined ? result.y : (type === 'scale' ? 1 : 0);
            result.z = result.z !== undefined ? result.z : (type === 'scale' ? 1 : 0);
        }
        return { value: result, warning };
    }
    async deleteNode(uuid) {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'remove-node', { uuid: uuid }).then(() => {
                resolve({
                    success: true,
                    message: 'Node deleted successfully'
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async moveNode(nodeUuid, newParentUuid, siblingIndex = -1) {
        return new Promise((resolve) => {
            // Use correct set-parent API instead of move-node
            Editor.Message.request('scene', 'set-parent', {
                parent: newParentUuid,
                uuids: [nodeUuid],
                keepWorldTransform: false
            }).then(() => {
                resolve({
                    success: true,
                    message: 'Node moved successfully'
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async duplicateNode(uuid, includeChildren = true) {
        return new Promise((resolve) => {
            // Note: includeChildren parameter is accepted for future use but not currently implemented
            Editor.Message.request('scene', 'duplicate-node', uuid).then((result) => {
                resolve({
                    success: true,
                    data: {
                        newUuid: result.uuid,
                        message: 'Node duplicated successfully'
                    }
                });
            }).catch((err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
    async detectNodeType(uuid) {
        return new Promise(async (resolve) => {
            try {
                const nodeInfoResponse = await this.getNodeInfo(uuid);
                if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
                    resolve({ success: false, error: 'Failed to get node information' });
                    return;
                }
                const nodeInfo = nodeInfoResponse.data;
                const is2D = this.is2DNode(nodeInfo);
                const components = nodeInfo.components || [];
                // Collect detection reasons
                const detectionReasons = [];
                // Check for 2D components
                const twoDComponents = components.filter((comp) => comp.type && (comp.type.includes('cc.Sprite') ||
                    comp.type.includes('cc.Label') ||
                    comp.type.includes('cc.Button') ||
                    comp.type.includes('cc.Layout') ||
                    comp.type.includes('cc.Widget') ||
                    comp.type.includes('cc.Mask') ||
                    comp.type.includes('cc.Graphics')));
                // Check for 3D components
                const threeDComponents = components.filter((comp) => comp.type && (comp.type.includes('cc.MeshRenderer') ||
                    comp.type.includes('cc.Camera') ||
                    comp.type.includes('cc.Light') ||
                    comp.type.includes('cc.DirectionalLight') ||
                    comp.type.includes('cc.PointLight') ||
                    comp.type.includes('cc.SpotLight')));
                if (twoDComponents.length > 0) {
                    detectionReasons.push(`Has 2D components: ${twoDComponents.map((c) => c.type).join(', ')}`);
                }
                if (threeDComponents.length > 0) {
                    detectionReasons.push(`Has 3D components: ${threeDComponents.map((c) => c.type).join(', ')}`);
                }
                // Check position for heuristic
                const position = nodeInfo.position;
                if (position && Math.abs(position.z) < 0.001) {
                    detectionReasons.push('Z position is ~0 (likely 2D)');
                }
                else if (position && Math.abs(position.z) > 0.001) {
                    detectionReasons.push(`Z position is ${position.z} (likely 3D)`);
                }
                if (detectionReasons.length === 0) {
                    detectionReasons.push('No specific indicators found, defaulting based on heuristics');
                }
                resolve({
                    success: true,
                    data: {
                        nodeUuid: uuid,
                        nodeName: nodeInfo.name,
                        nodeType: is2D ? '2D' : '3D',
                        detectionReasons: detectionReasons,
                        components: components.map((comp) => ({
                            type: comp.type,
                            category: this.getComponentCategory(comp.type)
                        })),
                        position: nodeInfo.position,
                        transformConstraints: {
                            position: is2D ? 'x, y only (z ignored)' : 'x, y, z all used',
                            rotation: is2D ? 'z only (x, y ignored)' : 'x, y, z all used',
                            scale: is2D ? 'x, y main, z typically 1' : 'x, y, z all used'
                        }
                    }
                });
            }
            catch (err) {
                resolve({
                    success: false,
                    error: `Failed to detect node type: ${err.message}`
                });
            }
        });
    }
    getComponentCategory(componentType) {
        if (!componentType)
            return 'unknown';
        if (componentType.includes('cc.Sprite') || componentType.includes('cc.Label') ||
            componentType.includes('cc.Button') || componentType.includes('cc.Layout') ||
            componentType.includes('cc.Widget') || componentType.includes('cc.Mask') ||
            componentType.includes('cc.Graphics')) {
            return '2D';
        }
        if (componentType.includes('cc.MeshRenderer') || componentType.includes('cc.Camera') ||
            componentType.includes('cc.Light') || componentType.includes('cc.DirectionalLight') ||
            componentType.includes('cc.PointLight') || componentType.includes('cc.SpotLight')) {
            return '3D';
        }
        return 'generic';
    }
}
exports.NodeTools = NodeTools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9kZS10b29scy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NvdXJjZS90b29scy9ub2RlLXRvb2xzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVEQUFtRDtBQUVuRCxNQUFhLFNBQVM7SUFBdEI7UUFDWSxtQkFBYyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFDO0lBcWxDbEQsQ0FBQztJQXBsQ0csUUFBUTtRQUNKLE9BQU87WUFDSDtnQkFDSSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsV0FBVyxFQUFFLDBOQUEwTjtnQkFDdk8sV0FBVyxFQUFFO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRTt3QkFDUixJQUFJLEVBQUU7NEJBQ0YsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLFdBQVc7eUJBQzNCO3dCQUNELFVBQVUsRUFBRTs0QkFDUixJQUFJLEVBQUUsUUFBUTs0QkFDZCxXQUFXLEVBQUUsMExBQTBMO3lCQUMxTTt3QkFDRCxRQUFRLEVBQUU7NEJBQ04sSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLGlDQUFpQzs0QkFDOUMsSUFBSSxFQUFFLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUM7NEJBQ2xDLE9BQU8sRUFBRSxNQUFNO3lCQUNsQjt3QkFDRCxZQUFZLEVBQUU7NEJBQ1YsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLHFEQUFxRDs0QkFDbEUsT0FBTyxFQUFFLENBQUMsQ0FBQzt5QkFDZDt3QkFDRCxTQUFTLEVBQUU7NEJBQ1AsSUFBSSxFQUFFLFFBQVE7NEJBQ2QsV0FBVyxFQUFFLHFJQUFxSTt5QkFDcko7d0JBQ0QsU0FBUyxFQUFFOzRCQUNQLElBQUksRUFBRSxRQUFROzRCQUNkLFdBQVcsRUFBRSx5R0FBeUc7eUJBQ3pIO3dCQUNELFVBQVUsRUFBRTs0QkFDUixJQUFJLEVBQUUsT0FBTzs0QkFDYixLQUFLLEVBQUUsRUFBRSxJQUFJLEVB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RSxDQUFBLE1BQUEsUUFBUSxDQUFDLElBQUksMENBQUUsS0FBSyxLQUFJLElBQUk7b0JBQ2xDLElBQUksRUFBRSxDQUFBLE1BQUEsUUFBUSxDQUFDLElBQUksMENBQUUsS0FBSyxLQUFJLFNBQVM7b0JBQ3ZDLE1BQU0sRUFBRSxDQUFBLE1BQUEsUUFBUSxDQUFDLE1BQU0sMENBQUUsS0FBSyxNQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUk7b0JBQzNFLFFBQVEsRUFBRSxDQUFBLE1BQUEsUUFBUSxDQUFDLFFBQVEsMENBQUUsS0FBSyxLQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUU7b0JBQzFELFFBQVEsRUFBRSxDQUFBLE1BQUEsUUFBUSxDQUFDLFFBQVEsMENBQUUsS0FBSyxLQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUU7b0JBQzFELEtBQUssRUFBRSxDQUFBLE1BQUEsUUFBUSxDQUFDLEtBQUssMENBQUUsS0FBSyxLQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUU7b0JBQ3BELE1BQU0sRUFBRSxDQUFBLE1BQUEsTUFBQSxRQUFRLENBQUMsTUFBTSwwQ0FBRSxLQUFLLDBDQUFFLElBQUksS0FBSSxJQUFJO29CQUM1QyxRQUFRLEVBQUUsUUFBUSxDQUFDLFFBQVEsSUFBSSxFQUFFO29CQUNqQyxVQUFVLEVBQUUsQ0FBQyxRQUFRLENBQUMsU0FBUyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQzt3QkFDdkQsSUFBSSxFQUFFLElBQUksQ0FBQyxRQUFRLElBQUksU0FBUzt3QkFDaEMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEtBQUss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QUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDeEMsT0FBTyxJQUFJLENBQUM7UUFDaEIsQ0FBQztRQUVELElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO1lBQ2hGLGFBQWEsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQztZQUNuRixhQUFhLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUNwRixPQUFPLElBQUksQ0FBQztRQUNoQixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztDQUNKO0FBdGxDRCw4QkFzbENDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVG9vbERlZmluaXRpb24sIFRvb2xSZXNwb25zZSwgVG9vbEV4ZWN1dG9yLCBOb2RlSW5mbyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IENvbXBvbmVudFRvb2xzIH0gZnJvbSAnLi9jb21wb25lbnQtdG9vbHMnO1xuXG5leHBvcnQgY2xhc3MgTm9kZVRvb2xzIGltcGxlbWVudHMgVG9vbEV4ZWN1dG9yIHtcbiAgICBwcml2YXRlIGNvbXBvbmVudFRvb2xzID0gbmV3IENvbXBvbmVudFRvb2xzKCk7XG4gICAgZ2V0VG9vbHMoKTogVG9vbERlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2NyZWF0ZV9ub2RlJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NyZWF0ZSBhIG5ldyBub2RlIGluIHRoZSBzY2VuZS4gU3VwcG9ydHMgY3JlYXRpbmcgZW1wdHkgbm9kZXMsIG5vZGVzIHdpdGggY29tcG9uZW50cywgb3IgaW5zdGFudGlhdGluZyBmcm9tIGFzc2V0cyAocHJlZmFicywgZXRjLikuIElNUE9SVEFOVDogWW91IHNob3VsZCBhbHdheXMgcHJvdmlkZSBwYXJlbnRVdWlkIHRvIHNwZWNpZnkgd2hlcmUgdG8gY3JlYXRlIHRoZSBub2RlLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05vZGUgbmFtZSdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRVdWlkOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQYXJlbnQgbm9kZSBVVUlELiBTVFJPTkdMWSBSRUNPTU1FTkRFRDogQWx3YXlzIHByb3ZpZGUgdGhpcyBwYXJhbWV0ZXIuIFVzZSBnZXRfY3VycmVudF9zY2VuZSBvciBnZXRfYWxsX25vZGVzIHRvIGZpbmQgcGFyZW50IFVVSURzLiBJZiBub3QgcHJvdmlkZWQsIG5vZGUgd2lsbCBiZSBjcmVhdGVkIGF0IHNjZW5lIHJvb3QuJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVUeXBlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdOb2RlIHR5cGU6IE5vZGUsIDJETm9kZSwgM0ROb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtOiBbJ05vZGUnLCAnMkROb2RlJywgJzNETm9kZSddLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6ICdOb2RlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpYmxpbmdJbmRleDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU2libGluZyBpbmRleCBmb3Igb3JkZXJpbmcgKC0xIG1lYW5zIGFwcGVuZCBhdCBlbmQpJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiAtMVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFzc2V0VXVpZDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQXNzZXQgVVVJRCB0byBpbnN0YW50aWF0ZSBmcm9tIChlLmcuLCBwcmVmYWIgVVVJRCkuIFdoZW4gcHJvdmlkZWQsIGNyZWF0ZXMgYSBub2RlIGluc3RhbmNlIGZyb20gdGhlIGFzc2V0IGluc3RlYWQgb2YgYW4gZW1wdHkgbm9kZS4nXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXRQYXRoOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBc3NldCBwYXRoIHRvIGluc3RhbnRpYXRlIGZyb20gKGUuZy4sIFwiZGI6Ly9hc3NldHMvcHJlZmFicy9NeVByZWZhYi5wcmVmYWJcIikuIEFsdGVybmF0aXZlIHRvIGFzc2V0VXVpZC4nXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9uZW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FycmF5IG9mIGNvbXBvbmVudCB0eXBlIG5hbWVzIHRvIGFkZCB0byB0aGUgbmV3IG5vZGUgKGUuZy4sIFtcImNjLlNwcml0ZVwiLCBcImNjLkJ1dHRvblwiXSknXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgdW5saW5rUHJlZmFiOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSWYgdHJ1ZSBhbmQgY3JlYXRpbmcgZnJvbSBwcmVmYWIsIHVubGluayBmcm9tIHByZWZhYiB0byBjcmVhdGUgYSByZWd1bGFyIG5vZGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IGZhbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAga2VlcFdvcmxkVHJhbnNmb3JtOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciB0byBrZWVwIHdvcmxkIHRyYW5zZm9ybSB3aGVuIGNyZWF0aW5nIHRoZSBub2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiBmYWxzZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGluaXRpYWxUcmFuc2Zvcm06IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB4OiB7IHR5cGU6ICdudW1iZXInIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeTogeyB0eXBlOiAnbnVtYmVyJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHo6IHsgdHlwZTogJ251bWJlcicgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3RhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeDogeyB0eXBlOiAnbnVtYmVyJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHk6IHsgdHlwZTogJ251bWJlcicgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB6OiB7IHR5cGU6ICdudW1iZXInIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NhbGU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHg6IHsgdHlwZTogJ251bWJlcicgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5OiB7IHR5cGU6ICdudW1iZXInIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgejogeyB0eXBlOiAnbnVtYmVyJyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSW5pdGlhbCB0cmFuc2Zvcm0gdG8gYXBwbHkgdG8gdGhlIGNyZWF0ZWQgbm9kZSdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsnbmFtZSddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X25vZGVfaW5mbycsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdHZXQgbm9kZSBpbmZvcm1hdGlvbiBieSBVVUlEJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTm9kZSBVVUlEJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1dWlkJ11cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdmaW5kX25vZGVzJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0ZpbmQgbm9kZXMgYnkgbmFtZSBwYXR0ZXJuJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBwYXR0ZXJuIHRvIHNlYXJjaCdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBleGFjdE1hdGNoOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRXhhY3QgbWF0Y2ggb3IgcGFydGlhbCBtYXRjaCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogZmFsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsncGF0dGVybiddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZmluZF9ub2RlX2J5X25hbWUnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRmluZCBmaXJzdCBub2RlIGJ5IGV4YWN0IG5hbWUnLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdOb2RlIG5hbWUgdG8gZmluZCdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsnbmFtZSddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ2V0X2FsbF9ub2RlcycsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdHZXQgYWxsIG5vZGVzIGluIHRoZSBzY2VuZSB3aXRoIHRoZWlyIFVVSURzJyxcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge31cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdzZXRfbm9kZV9wcm9wZXJ0eScsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdTZXQgbm9kZSBwcm9wZXJ0eSB2YWx1ZSAocHJlZmVyIHVzaW5nIHNldF9ub2RlX3RyYW5zZm9ybSBmb3IgYWN0aXZlL2xheWVyL21vYmlsaXR5L3Bvc2l0aW9uL3JvdGF0aW9uL3NjYWxlKScsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05vZGUgVVVJRCdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0eToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUHJvcGVydHkgbmFtZSAoZS5nLiwgYWN0aXZlLCBuYW1lLCBsYXllciknXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Byb3BlcnR5IHZhbHVlJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1dWlkJywgJ3Byb3BlcnR5JywgJ3ZhbHVlJ11cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdzZXRfbm9kZV90cmFuc2Zvcm0nLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU2V0IG5vZGUgdHJhbnNmb3JtIHByb3BlcnRpZXMgKHBvc2l0aW9uLCByb3RhdGlvbiwgc2NhbGUpIHdpdGggdW5pZmllZCBpbnRlcmZhY2UuIEF1dG9tYXRpY2FsbHkgaGFuZGxlcyAyRC8zRCBub2RlIGRpZmZlcmVuY2VzLicsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05vZGUgVVVJRCdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBwb3NpdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeDogeyB0eXBlOiAnbnVtYmVyJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5OiB7IHR5cGU6ICdudW1iZXInIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHo6IHsgdHlwZTogJ251bWJlcicsIGRlc2NyaXB0aW9uOiAnWiBjb29yZGluYXRlIChpZ25vcmVkIGZvciAyRCBub2RlcyknIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTm9kZSBwb3NpdGlvbi4gRm9yIDJEIG5vZGVzLCBvbmx5IHgseSBhcmUgdXNlZDsgeiBpcyBpZ25vcmVkLiBGb3IgM0Qgbm9kZXMsIGFsbCBjb29yZGluYXRlcyBhcmUgdXNlZC4nXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHg6IHsgdHlwZTogJ251bWJlcicsIGRlc2NyaXB0aW9uOiAnWCByb3RhdGlvbiAoaWdub3JlZCBmb3IgMkQgbm9kZXMpJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5OiB7IHR5cGU6ICdudW1iZXInLCBkZXNjcmlwdGlvbjogJ1kgcm90YXRpb24gKGlnbm9yZWQgZm9yIDJEIG5vZGVzKScgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgejogeyB0eXBlOiAnbnVtYmVyJywgZGVzY3JpcHRpb246ICdaIHJvdGF0aW9uIChtYWluIHJvdGF0aW9uIGF4aXMgZm9yIDJEIG5vZGVzKScgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdOb2RlIHJvdGF0aW9uIGluIGV1bGVyIGFuZ2xlcy4gRm9yIDJEIG5vZGVzLCBvbmx5IHogcm90YXRpb24gaXMgdXNlZC4gRm9yIDNEIG5vZGVzLCBhbGwgYXhlcyBhcmUgdXNlZC4nXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2NhbGU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHg6IHsgdHlwZTogJ251bWJlcicgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeTogeyB0eXBlOiAnbnVtYmVyJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB6OiB7IHR5cGU6ICdudW1iZXInLCBkZXNjcmlwdGlvbjogJ1ogc2NhbGUgKHVzdWFsbHkgMSBmb3IgMkQgbm9kZXMpJyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05vZGUgc2NhbGUuIEZvciAyRCBub2RlcywgeiBpcyB0eXBpY2FsbHkgMS4gRm9yIDNEIG5vZGVzLCBhbGwgYXhlcyBhcmUgdXNlZC4nXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3V1aWQnXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2RlbGV0ZV9ub2RlJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBhIG5vZGUgZnJvbSBzY2VuZScsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05vZGUgVVVJRCB0byBkZWxldGUnXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3V1aWQnXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ21vdmVfbm9kZScsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdNb3ZlIG5vZGUgdG8gbmV3IHBhcmVudCcsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVVdWlkOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdOb2RlIFVVSUQgdG8gbW92ZSdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdQYXJlbnRVdWlkOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdOZXcgcGFyZW50IG5vZGUgVVVJRCdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzaWJsaW5nSW5kZXg6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NpYmxpbmcgaW5kZXggaW4gbmV3IHBhcmVudCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogLTFcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsnbm9kZVV1aWQnLCAnbmV3UGFyZW50VXVpZCddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZHVwbGljYXRlX25vZGUnLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRHVwbGljYXRlIGEgbm9kZScsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05vZGUgVVVJRCB0byBkdXBsaWNhdGUnXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVkZUNoaWxkcmVuOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSW5jbHVkZSBjaGlsZHJlbiBub2RlcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogWyd1dWlkJ11cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdkZXRlY3Rfbm9kZV90eXBlJyxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0RldGVjdCBpZiBhIG5vZGUgaXMgMkQgb3IgM0QgYmFzZWQgb24gaXRzIGNvbXBvbmVudHMgYW5kIHByb3BlcnRpZXMnLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1dWlkOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdOb2RlIFVVSUQgdG8gYW5hbHl6ZSdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFsndXVpZCddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICBdO1xuICAgIH1cblxuICAgIGFzeW5jIGV4ZWN1dGUodG9vbE5hbWU6IHN0cmluZywgYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgc3dpdGNoICh0b29sTmFtZSkge1xuICAgICAgICAgICAgY2FzZSAnY3JlYXRlX25vZGUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNyZWF0ZU5vZGUoYXJncyk7XG4gICAgICAgICAgICBjYXNlICdnZXRfbm9kZV9pbmZvJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXROb2RlSW5mbyhhcmdzLnV1aWQpO1xuICAgICAgICAgICAgY2FzZSAnZmluZF9ub2Rlcyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZmluZE5vZGVzKGFyZ3MucGF0dGVybiwgYXJncy5leGFjdE1hdGNoKTtcbiAgICAgICAgICAgIGNhc2UgJ2ZpbmRfbm9kZV9ieV9uYW1lJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5maW5kTm9kZUJ5TmFtZShhcmdzLm5hbWUpO1xuICAgICAgICAgICAgY2FzZSAnZ2V0X2FsbF9ub2Rlcyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0QWxsTm9kZXMoKTtcbiAgICAgICAgICAgIGNhc2UgJ3NldF9ub2RlX3Byb3BlcnR5JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5zZXROb2RlUHJvcGVydHkoYXJncy51dWlkLCBhcmdzLnByb3BlcnR5LCBhcmdzLnZhbHVlKTtcbiAgICAgICAgICAgIGNhc2UgJ3NldF9ub2RlX3RyYW5zZm9ybSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc2V0Tm9kZVRyYW5zZm9ybShhcmdzKTtcbiAgICAgICAgICAgIGNhc2UgJ2RlbGV0ZV9ub2RlJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5kZWxldGVOb2RlKGFyZ3MudXVpZCk7XG4gICAgICAgICAgICBjYXNlICdtb3ZlX25vZGUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLm1vdmVOb2RlKGFyZ3Mubm9kZVV1aWQsIGFyZ3MubmV3UGFyZW50VXVpZCwgYXJncy5zaWJsaW5nSW5kZXgpO1xuICAgICAgICAgICAgY2FzZSAnZHVwbGljYXRlX25vZGUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmR1cGxpY2F0ZU5vZGUoYXJncy51dWlkLCBhcmdzLmluY2x1ZGVDaGlsZHJlbik7XG4gICAgICAgICAgICBjYXNlICdkZXRlY3Rfbm9kZV90eXBlJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5kZXRlY3ROb2RlVHlwZShhcmdzLnV1aWQpO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gdG9vbDogJHt0b29sTmFtZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlTm9kZShhcmdzOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgbGV0IHRhcmdldFBhcmVudFV1aWQgPSBhcmdzLnBhcmVudFV1aWQ7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gSWYgbm8gcGFyZW50IG5vZGUgVVVJRCBpcyBwcm92aWRlZCwgZ2V0IHRoZSBzY2VuZSByb290IG5vZGVcbiAgICAgICAgICAgICAgICBpZiAoIXRhcmdldFBhcmVudFV1aWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNjZW5lSW5mbyA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNjZW5lSW5mbyAmJiB0eXBlb2Ygc2NlbmVJbmZvID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShzY2VuZUluZm8pICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChzY2VuZUluZm8sICd1dWlkJykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRQYXJlbnRVdWlkID0gKHNjZW5lSW5mbyBhcyBhbnkpLnV1aWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYE5vIHBhcmVudCBzcGVjaWZpZWQsIHVzaW5nIHNjZW5lIHJvb3Q6ICR7dGFyZ2V0UGFyZW50VXVpZH1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShzY2VuZUluZm8pICYmIHNjZW5lSW5mby5sZW5ndGggPiAwICYmIHNjZW5lSW5mb1swXS51dWlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0UGFyZW50VXVpZCA9IHNjZW5lSW5mb1swXS51dWlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBObyBwYXJlbnQgc3BlY2lmaWVkLCB1c2luZyBzY2VuZSByb290OiAke3RhcmdldFBhcmVudFV1aWR9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRTY2VuZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWN1cnJlbnQtc2NlbmUnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudFNjZW5lICYmIGN1cnJlbnRTY2VuZS51dWlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldFBhcmVudFV1aWQgPSBjdXJyZW50U2NlbmUudXVpZDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gZ2V0IHNjZW5lIHJvb3QsIHdpbGwgdXNlIGRlZmF1bHQgYmVoYXZpb3InKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIElmIGFzc2V0UGF0aCBpcyBwcm92aWRlZCwgcmVzb2x2ZSBpdCB0byBhc3NldFV1aWQgZmlyc3RcbiAgICAgICAgICAgICAgICBsZXQgZmluYWxBc3NldFV1aWQgPSBhcmdzLmFzc2V0VXVpZDtcbiAgICAgICAgICAgICAgICBpZiAoYXJncy5hc3NldFBhdGggJiYgIWZpbmFsQXNzZXRVdWlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldEluZm8gPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgYXJncy5hc3NldFBhdGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFzc2V0SW5mbyAmJiBhc3NldEluZm8udXVpZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbmFsQXNzZXRVdWlkID0gYXNzZXRJbmZvLnV1aWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYEFzc2V0IHBhdGggJyR7YXJncy5hc3NldFBhdGh9JyByZXNvbHZlZCB0byBVVUlEOiAke2ZpbmFsQXNzZXRVdWlkfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBgQXNzZXQgbm90IGZvdW5kIGF0IHBhdGg6ICR7YXJncy5hc3NldFBhdGh9YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogYEZhaWxlZCB0byByZXNvbHZlIGFzc2V0IHBhdGggJyR7YXJncy5hc3NldFBhdGh9JzogJHtlcnJ9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBCdWlsZCBjcmVhdGUtbm9kZSBvcHRpb25zXG4gICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlTm9kZU9wdGlvbnM6IGFueSA9IHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYXJncy5uYW1lXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIC8vIFNldCB0aGUgcGFyZW50IG5vZGVcbiAgICAgICAgICAgICAgICBpZiAodGFyZ2V0UGFyZW50VXVpZCkge1xuICAgICAgICAgICAgICAgICAgICBjcmVhdGVOb2RlT3B0aW9ucy5wYXJlbnQgPSB0YXJnZXRQYXJlbnRVdWlkO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIEluc3RhbnRpYXRlIGZyb20gYW4gYXNzZXRcbiAgICAgICAgICAgICAgICBpZiAoZmluYWxBc3NldFV1aWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlTm9kZU9wdGlvbnMuYXNzZXRVdWlkID0gZmluYWxBc3NldFV1aWQ7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhcmdzLnVubGlua1ByZWZhYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlTm9kZU9wdGlvbnMudW5saW5rUHJlZmFiID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIEFkZCBjb21wb25lbnRzXG4gICAgICAgICAgICAgICAgaWYgKGFyZ3MuY29tcG9uZW50cyAmJiBhcmdzLmNvbXBvbmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBjcmVhdGVOb2RlT3B0aW9ucy5jb21wb25lbnRzID0gYXJncy5jb21wb25lbnRzO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYXJncy5ub2RlVHlwZSAmJiBhcmdzLm5vZGVUeXBlICE9PSAnTm9kZScgJiYgIWZpbmFsQXNzZXRVdWlkKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0aGUgbm9kZVR5cGUgY29tcG9uZW50IG9ubHkgd2hlbiBub3QgaW5zdGFudGlhdGluZyBmcm9tIGFuIGFzc2V0XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZU5vZGVPcHRpb25zLmNvbXBvbmVudHMgPSBbYXJncy5ub2RlVHlwZV07XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gS2VlcCB0aGUgd29ybGQgdHJhbnNmb3JtXG4gICAgICAgICAgICAgICAgaWYgKGFyZ3Mua2VlcFdvcmxkVHJhbnNmb3JtKSB7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZU5vZGVPcHRpb25zLmtlZXBXb3JsZFRyYW5zZm9ybSA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gRG8gbm90IHVzZSBkdW1wIHBhcmFtZXRlcnMgZm9yIHRoZSBpbml0aWFsIHRyYW5zZm9ybTsgc2V0IGl0IHdpdGggc2V0X25vZGVfdHJhbnNmb3JtIGFmdGVyIGNyZWF0aW9uXG5cbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQ3JlYXRpbmcgbm9kZSB3aXRoIG9wdGlvbnM6JywgY3JlYXRlTm9kZU9wdGlvbnMpO1xuXG4gICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHRoZSBub2RlXG4gICAgICAgICAgICAgICAgY29uc3Qgbm9kZVV1aWQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdjcmVhdGUtbm9kZScsIGNyZWF0ZU5vZGVPcHRpb25zKTtcbiAgICAgICAgICAgICAgICBjb25zdCB1dWlkID0gQXJyYXkuaXNBcnJheShub2RlVXVpZCkgPyBub2RlVXVpZFswXSA6IG5vZGVVdWlkO1xuXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIHRoZSBzaWJsaW5nIGluZGV4XG4gICAgICAgICAgICAgICAgaWYgKGFyZ3Muc2libGluZ0luZGV4ICE9PSB1bmRlZmluZWQgJiYgYXJncy5zaWJsaW5nSW5kZXggPj0gMCAmJiB1dWlkICYmIHRhcmdldFBhcmVudFV1aWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTsgLy8gV2FpdCBmb3IgdGhlIGludGVybmFsIHN0YXRlIHRvIHVwZGF0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2V0LXBhcmVudCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnQ6IHRhcmdldFBhcmVudFV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZHM6IFt1dWlkXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZWVwV29ybGRUcmFuc2Zvcm06IGFyZ3Mua2VlcFdvcmxkVHJhbnNmb3JtIHx8IGZhbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBzZXQgc2libGluZyBpbmRleDonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gQWRkIGNvbXBvbmVudHMgaWYgdGhleSB3ZXJlIHByb3ZpZGVkXG4gICAgICAgICAgICAgICAgaWYgKGFyZ3MuY29tcG9uZW50cyAmJiBhcmdzLmNvbXBvbmVudHMubGVuZ3RoID4gMCAmJiB1dWlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7IC8vIFdhaXQgZm9yIG5vZGUgY3JlYXRpb24gdG8gZmluaXNoXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGNvbXBvbmVudFR5cGUgb2YgYXJncy5jb21wb25lbnRzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb21wb25lbnRUb29scy5leGVjdXRlKCdhZGRfY29tcG9uZW50Jywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbm9kZVV1aWQ6IHV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRUeXBlOiBjb21wb25lbnRUeXBlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBDb21wb25lbnQgJHtjb21wb25lbnRUeXBlfSBhZGRlZCBzdWNjZXNzZnVsbHlgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgRmFpbGVkIHRvIGFkZCBjb21wb25lbnQgJHtjb21wb25lbnRUeXBlfTpgLCByZXN1bHQuZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgRmFpbGVkIHRvIGFkZCBjb21wb25lbnQgJHtjb21wb25lbnRUeXBlfTpgLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBhZGQgY29tcG9uZW50czonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU2V0IHRoZSBpbml0aWFsIHRyYW5zZm9ybSBpZiBpdCB3YXMgcHJvdmlkZWRcbiAgICAgICAgICAgICAgICBpZiAoYXJncy5pbml0aWFsVHJhbnNmb3JtICYmIHV1aWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxNTApKTsgLy8gV2FpdCBmb3Igbm9kZSBhbmQgY29tcG9uZW50IGNyZWF0aW9uIHRvIGZpbmlzaFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXROb2RlVHJhbnNmb3JtKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1dWlkOiB1dWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBhcmdzLmluaXRpYWxUcmFuc2Zvcm0ucG9zaXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcm90YXRpb246IGFyZ3MuaW5pdGlhbFRyYW5zZm9ybS5yb3RhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY2FsZTogYXJncy5pbml0aWFsVHJhbnNmb3JtLnNjYWxlXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdJbml0aWFsIHRyYW5zZm9ybSBhcHBsaWVkIHN1Y2Nlc3NmdWxseScpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignRmFpbGVkIHRvIHNldCBpbml0aWFsIHRyYW5zZm9ybTonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gR2V0IHRoZSBjcmVhdGVkIG5vZGUgaW5mb3JtYXRpb24gZm9yIHZlcmlmaWNhdGlvblxuICAgICAgICAgICAgICAgIGxldCB2ZXJpZmljYXRpb25EYXRhOiBhbnkgPSBudWxsO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5vZGVJbmZvID0gYXdhaXQgdGhpcy5nZXROb2RlSW5mbyh1dWlkKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vZGVJbmZvLnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkRhdGEgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbm9kZUluZm86IG5vZGVJbmZvLmRhdGEsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudFV1aWQ6IHRhcmdldFBhcmVudFV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVUeXBlOiBhcmdzLm5vZGVUeXBlIHx8ICdOb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnJvbUFzc2V0OiAhIWZpbmFsQXNzZXRVdWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhc3NldFV1aWQ6IGZpbmFsQXNzZXRVdWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhc3NldFBhdGg6IGFyZ3MuYXNzZXRQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gZ2V0IHZlcmlmaWNhdGlvbiBkYXRhOicsIGVycik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3Qgc3VjY2Vzc01lc3NhZ2UgPSBmaW5hbEFzc2V0VXVpZCBcbiAgICAgICAgICAgICAgICAgICAgPyBgTm9kZSAnJHthcmdzLm5hbWV9JyBpbnN0YW50aWF0ZWQgZnJvbSBhc3NldCBzdWNjZXNzZnVsbHlgXG4gICAgICAgICAgICAgICAgICAgIDogYE5vZGUgJyR7YXJncy5uYW1lfScgY3JlYXRlZCBzdWNjZXNzZnVsbHlgO1xuXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IHV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBhcmdzLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRVdWlkOiB0YXJnZXRQYXJlbnRVdWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgbm9kZVR5cGU6IGFyZ3Mubm9kZVR5cGUgfHwgJ05vZGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZnJvbUFzc2V0OiAhIWZpbmFsQXNzZXRVdWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXRVdWlkOiBmaW5hbEFzc2V0VXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHN1Y2Nlc3NNZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkRhdGE6IHZlcmlmaWNhdGlvbkRhdGFcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gY3JlYXRlIG5vZGU6ICR7ZXJyLm1lc3NhZ2V9LiBBcmdzOiAke0pTT04uc3RyaW5naWZ5KGFyZ3MpfWBcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBnZXROb2RlSW5mbyh1dWlkOiBzdHJpbmcpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCB1dWlkKS50aGVuKChub2RlRGF0YTogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFub2RlRGF0YSkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6ICdOb2RlIG5vdCBmb3VuZCBvciBpbnZhbGlkIHJlc3BvbnNlJ1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBQYXJzZSBub2RlIGluZm9ybWF0aW9uIGJhc2VkIG9uIHRoZSBhY3R1YWwgcmV0dXJuZWQgZGF0YSBzdHJ1Y3R1cmVcbiAgICAgICAgICAgICAgICBjb25zdCBpbmZvOiBOb2RlSW5mbyA9IHtcbiAgICAgICAgICAgICAgICAgICAgdXVpZDogbm9kZURhdGEudXVpZD8udmFsdWUgfHwgdXVpZCxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogbm9kZURhdGEubmFtZT8udmFsdWUgfHwgJ1Vua25vd24nLFxuICAgICAgICAgICAgICAgICAgICBhY3RpdmU6IG5vZGVEYXRhLmFjdGl2ZT8udmFsdWUgIT09IHVuZGVmaW5lZCA/IG5vZGVEYXRhLmFjdGl2ZS52YWx1ZSA6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBub2RlRGF0YS5wb3NpdGlvbj8udmFsdWUgfHwgeyB4OiAwLCB5OiAwLCB6OiAwIH0sXG4gICAgICAgICAgICAgICAgICAgIHJvdGF0aW9uOiBub2RlRGF0YS5yb3RhdGlvbj8udmFsdWUgfHwgeyB4OiAwLCB5OiAwLCB6OiAwIH0sXG4gICAgICAgICAgICAgICAgICAgIHNjYWxlOiBub2RlRGF0YS5zY2FsZT8udmFsdWUgfHwgeyB4OiAxLCB5OiAxLCB6OiAxIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudDogbm9kZURhdGEucGFyZW50Py52YWx1ZT8udXVpZCB8fCBudWxsLFxuICAgICAgICAgICAgICAgICAgICBjaGlsZHJlbjogbm9kZURhdGEuY2hpbGRyZW4gfHwgW10sXG4gICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHM6IChub2RlRGF0YS5fX2NvbXBzX18gfHwgW10pLm1hcCgoY29tcDogYW55KSA9PiAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogY29tcC5fX3R5cGVfXyB8fCAnVW5rbm93bicsXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiBjb21wLmVuYWJsZWQgIT09IHVuZGVmaW5lZCA/IGNvbXAuZW5hYmxlZCA6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSkpLFxuICAgICAgICAgICAgICAgICAgICBsYXllcjogbm9kZURhdGEubGF5ZXI/LnZhbHVlIHx8IDEwNzM3NDE4MjQsXG4gICAgICAgICAgICAgICAgICAgIG1vYmlsaXR5OiBub2RlRGF0YS5tb2JpbGl0eT8udmFsdWUgfHwgMFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IHRydWUsIGRhdGE6IGluZm8gfSk7XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgZmluZE5vZGVzKHBhdHRlcm46IHN0cmluZywgZXhhY3RNYXRjaDogYm9vbGVhbiA9IGZhbHNlKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICAvLyBOb3RlOiAncXVlcnktbm9kZXMtYnktbmFtZScgQVBJIGRvZXNuJ3QgZXhpc3QgaW4gb2ZmaWNpYWwgZG9jdW1lbnRhdGlvblxuICAgICAgICAgICAgLy8gVXNpbmcgdHJlZSB0cmF2ZXJzYWwgYXMgcHJpbWFyeSBhcHByb2FjaFxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZS10cmVlJykudGhlbigodHJlZTogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3Qgbm9kZXM6IGFueVtdID0gW107XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoVHJlZSA9IChub2RlOiBhbnksIGN1cnJlbnRQYXRoOiBzdHJpbmcgPSAnJykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBub2RlUGF0aCA9IGN1cnJlbnRQYXRoID8gYCR7Y3VycmVudFBhdGh9LyR7bm9kZS5uYW1lfWAgOiBub2RlLm5hbWU7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXRjaGVzID0gZXhhY3RNYXRjaCA/IFxuICAgICAgICAgICAgICAgICAgICAgICAgbm9kZS5uYW1lID09PSBwYXR0ZXJuIDogXG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlLm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhwYXR0ZXJuLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IG5vZGUudXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBub2RlLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogbm9kZVBhdGhcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAobm9kZS5jaGlsZHJlbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VhcmNoVHJlZShjaGlsZCwgbm9kZVBhdGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodHJlZSkge1xuICAgICAgICAgICAgICAgICAgICBzZWFyY2hUcmVlKHRyZWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogdHJ1ZSwgZGF0YTogbm9kZXMgfSk7XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgdGhlIHNjZW5lIHNjcmlwdFxuICAgICAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdjb2Nvcy1tY3Atc2VydmVyJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnZmluZE5vZGVzJyxcbiAgICAgICAgICAgICAgICAgICAgYXJnczogW3BhdHRlcm4sIGV4YWN0TWF0Y2hdXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdleGVjdXRlLXNjZW5lLXNjcmlwdCcsIG9wdGlvbnMpLnRoZW4oKHJlc3VsdDogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9KS5jYXRjaCgoZXJyMjogRXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYFRyZWUgc2VhcmNoIGZhaWxlZDogJHtlcnIubWVzc2FnZX0sIFNjZW5lIHNjcmlwdCBmYWlsZWQ6ICR7ZXJyMi5tZXNzYWdlfWAgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBmaW5kTm9kZUJ5TmFtZShuYW1lOiBzdHJpbmcpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIC8vIFByZWZlciBxdWVyeWluZyBhbmQgc2VhcmNoaW5nIHRoZSBub2RlIHRyZWUgdGhyb3VnaCB0aGUgRWRpdG9yIEFQSVxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZS10cmVlJykudGhlbigodHJlZTogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZm91bmROb2RlID0gdGhpcy5zZWFyY2hOb2RlSW5UcmVlKHRyZWUsIG5hbWUpO1xuICAgICAgICAgICAgICAgIGlmIChmb3VuZE5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHV1aWQ6IGZvdW5kTm9kZS51dWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGZvdW5kTm9kZS5uYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHRoaXMuZ2V0Tm9kZVBhdGgoZm91bmROb2RlKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgTm9kZSAnJHtuYW1lfScgbm90IGZvdW5kYCB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgdGhlIHNjZW5lIHNjcmlwdFxuICAgICAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdjb2Nvcy1tY3Atc2VydmVyJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnZmluZE5vZGVCeU5hbWUnLFxuICAgICAgICAgICAgICAgICAgICBhcmdzOiBbbmFtZV1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2V4ZWN1dGUtc2NlbmUtc2NyaXB0Jywgb3B0aW9ucykudGhlbigocmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICAgICAgICAgIH0pLmNhdGNoKChlcnIyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgRGlyZWN0IEFQSSBmYWlsZWQ6ICR7ZXJyLm1lc3NhZ2V9LCBTY2VuZSBzY3JpcHQgZmFpbGVkOiAke2VycjIubWVzc2FnZX1gIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2VhcmNoTm9kZUluVHJlZShub2RlOiBhbnksIHRhcmdldE5hbWU6IHN0cmluZyk6IGFueSB7XG4gICAgICAgIGlmIChub2RlLm5hbWUgPT09IHRhcmdldE5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAobm9kZS5jaGlsZHJlbikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZm91bmQgPSB0aGlzLnNlYXJjaE5vZGVJblRyZWUoY2hpbGQsIHRhcmdldE5hbWUpO1xuICAgICAgICAgICAgICAgIGlmIChmb3VuZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZm91bmQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGdldEFsbE5vZGVzKCk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgLy8gVHJ5IHF1ZXJ5aW5nIHRoZSBzY2VuZSBub2RlIHRyZWVcbiAgICAgICAgICAgIEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScpLnRoZW4oKHRyZWU6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5vZGVzOiBhbnlbXSA9IFtdO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IHRyYXZlcnNlVHJlZSA9IChub2RlOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICB1dWlkOiBub2RlLnV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBub2RlLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBub2RlLnR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU6IG5vZGUuYWN0aXZlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogdGhpcy5nZXROb2RlUGF0aChub2RlKVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmIChub2RlLmNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmF2ZXJzZVRyZWUoY2hpbGQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAodHJlZSAmJiB0cmVlLmNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyYXZlcnNlVHJlZSh0cmVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvdGFsTm9kZXM6IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVzOiBub2Rlc1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgdGhlIHNjZW5lIHNjcmlwdFxuICAgICAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdjb2Nvcy1tY3Atc2VydmVyJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnZ2V0QWxsTm9kZXMnLFxuICAgICAgICAgICAgICAgICAgICBhcmdzOiBbXVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnZXhlY3V0ZS1zY2VuZS1zY3JpcHQnLCBvcHRpb25zKS50aGVuKChyZXN1bHQ6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgfSkuY2F0Y2goKGVycjI6IEVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBEaXJlY3QgQVBJIGZhaWxlZDogJHtlcnIubWVzc2FnZX0sIFNjZW5lIHNjcmlwdCBmYWlsZWQ6ICR7ZXJyMi5tZXNzYWdlfWAgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXROb2RlUGF0aChub2RlOiBhbnkpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCBwYXRoID0gW25vZGUubmFtZV07XG4gICAgICAgIGxldCBjdXJyZW50ID0gbm9kZS5wYXJlbnQ7XG4gICAgICAgIHdoaWxlIChjdXJyZW50ICYmIGN1cnJlbnQubmFtZSAhPT0gJ0NhbnZhcycpIHtcbiAgICAgICAgICAgIHBhdGgudW5zaGlmdChjdXJyZW50Lm5hbWUpO1xuICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwYXRoLmpvaW4oJy8nKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHNldE5vZGVQcm9wZXJ0eSh1dWlkOiBzdHJpbmcsIHByb3BlcnR5OiBzdHJpbmcsIHZhbHVlOiBhbnkpOiBQcm9taXNlPFRvb2xSZXNwb25zZT4ge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIC8vIFRyeSBzZXR0aW5nIHRoZSBub2RlIHByb3BlcnR5IGRpcmVjdGx5IHRocm91Z2ggdGhlIEVkaXRvciBBUElcbiAgICAgICAgICAgIEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NldC1wcm9wZXJ0eScsIHtcbiAgICAgICAgICAgICAgICB1dWlkOiB1dWlkLFxuICAgICAgICAgICAgICAgIHBhdGg6IHByb3BlcnR5LFxuICAgICAgICAgICAgICAgIGR1bXA6IHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gR2V0IGNvbXByZWhlbnNpdmUgdmVyaWZpY2F0aW9uIGRhdGEgaW5jbHVkaW5nIHVwZGF0ZWQgbm9kZSBpbmZvXG4gICAgICAgICAgICAgICAgdGhpcy5nZXROb2RlSW5mbyh1dWlkKS50aGVuKChub2RlSW5mbykgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgUHJvcGVydHkgJyR7cHJvcGVydHl9JyB1cGRhdGVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbm9kZVV1aWQ6IHV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydHk6IHByb3BlcnR5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5ld1ZhbHVlOiB2YWx1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBub2RlSW5mbzogbm9kZUluZm8uZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VEZXRhaWxzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BlcnR5OiBwcm9wZXJ0eSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSkuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgUHJvcGVydHkgJyR7cHJvcGVydHl9JyB1cGRhdGVkIHN1Y2Nlc3NmdWxseSAodmVyaWZpY2F0aW9uIGZhaWxlZClgXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSkuY2F0Y2goKGVycjogRXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBJZiBkaXJlY3QgYXNzaWdubWVudCBmYWlscywgdHJ5IHVzaW5nIHRoZSBzY2VuZSBzY3JpcHRcbiAgICAgICAgICAgICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnY29jb3MtbWNwLXNlcnZlcicsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ3NldE5vZGVQcm9wZXJ0eScsXG4gICAgICAgICAgICAgICAgICAgIGFyZ3M6IFt1dWlkLCBwcm9wZXJ0eSwgdmFsdWVdXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdleGVjdXRlLXNjZW5lLXNjcmlwdCcsIG9wdGlvbnMpLnRoZW4oKHJlc3VsdDogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgICAgICB9KS5jYXRjaCgoZXJyMjogRXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYERpcmVjdCBBUEkgZmFpbGVkOiAke2Vyci5tZXNzYWdlfSwgU2NlbmUgc2NyaXB0IGZhaWxlZDogJHtlcnIyLm1lc3NhZ2V9YCB9KTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHNldE5vZGVUcmFuc2Zvcm0oYXJnczogYW55KTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IHV1aWQsIHBvc2l0aW9uLCByb3RhdGlvbiwgc2NhbGUgfSA9IGFyZ3M7XG4gICAgICAgICAgICBjb25zdCB1cGRhdGVQcm9taXNlczogUHJvbWlzZTxhbnk+W10gPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IHVwZGF0ZXM6IHN0cmluZ1tdID0gW107XG4gICAgICAgICAgICBjb25zdCB3YXJuaW5nczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyBGaXJzdCBnZXQgbm9kZSBpbmZvIHRvIGRldGVybWluZSBpZiBpdCdzIDJEIG9yIDNEXG4gICAgICAgICAgICAgICAgY29uc3Qgbm9kZUluZm9SZXNwb25zZSA9IGF3YWl0IHRoaXMuZ2V0Tm9kZUluZm8odXVpZCk7XG4gICAgICAgICAgICAgICAgaWYgKCFub2RlSW5mb1Jlc3BvbnNlLnN1Y2Nlc3MgfHwgIW5vZGVJbmZvUmVzcG9uc2UuZGF0YSkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnRmFpbGVkIHRvIGdldCBub2RlIGluZm9ybWF0aW9uJyB9KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBub2RlSW5mbyA9IG5vZGVJbmZvUmVzcG9uc2UuZGF0YTtcbiAgICAgICAgICAgICAgICBjb25zdCBpczJETm9kZSA9IHRoaXMuaXMyRE5vZGUobm9kZUluZm8pO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChwb3NpdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBub3JtYWxpemVkUG9zaXRpb24gPSB0aGlzLm5vcm1hbGl6ZVRyYW5zZm9ybVZhbHVlKHBvc2l0aW9uLCAncG9zaXRpb24nLCBpczJETm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkUG9zaXRpb24ud2FybmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgd2FybmluZ3MucHVzaChub3JtYWxpemVkUG9zaXRpb24ud2FybmluZyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZVByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtcHJvcGVydHknLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogdXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAncG9zaXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGR1bXA6IHsgdmFsdWU6IG5vcm1hbGl6ZWRQb3NpdGlvbi52YWx1ZSB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB1cGRhdGVzLnB1c2goJ3Bvc2l0aW9uJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChyb3RhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBub3JtYWxpemVkUm90YXRpb24gPSB0aGlzLm5vcm1hbGl6ZVRyYW5zZm9ybVZhbHVlKHJvdGF0aW9uLCAncm90YXRpb24nLCBpczJETm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkUm90YXRpb24ud2FybmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgd2FybmluZ3MucHVzaChub3JtYWxpemVkUm90YXRpb24ud2FybmluZyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZVByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtcHJvcGVydHknLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogdXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAncm90YXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGR1bXA6IHsgdmFsdWU6IG5vcm1hbGl6ZWRSb3RhdGlvbi52YWx1ZSB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB1cGRhdGVzLnB1c2goJ3JvdGF0aW9uJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChzY2FsZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBub3JtYWxpemVkU2NhbGUgPSB0aGlzLm5vcm1hbGl6ZVRyYW5zZm9ybVZhbHVlKHNjYWxlLCAnc2NhbGUnLCBpczJETm9kZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub3JtYWxpemVkU2NhbGUud2FybmluZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgd2FybmluZ3MucHVzaChub3JtYWxpemVkU2NhbGUud2FybmluZyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZVByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtcHJvcGVydHknLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZDogdXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAnc2NhbGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGR1bXA6IHsgdmFsdWU6IG5vcm1hbGl6ZWRTY2FsZS52YWx1ZSB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB1cGRhdGVzLnB1c2goJ3NjYWxlJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICh1cGRhdGVQcm9taXNlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ05vIHRyYW5zZm9ybSBwcm9wZXJ0aWVzIHNwZWNpZmllZCcgfSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodXBkYXRlUHJvbWlzZXMpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY2hhbmdlcyBieSBnZXR0aW5nIHVwZGF0ZWQgbm9kZSBpbmZvXG4gICAgICAgICAgICAgICAgY29uc3QgdXBkYXRlZE5vZGVJbmZvID0gYXdhaXQgdGhpcy5nZXROb2RlSW5mbyh1dWlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZTogYW55ID0ge1xuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgVHJhbnNmb3JtIHByb3BlcnRpZXMgdXBkYXRlZDogJHt1cGRhdGVzLmpvaW4oJywgJyl9ICR7aXMyRE5vZGUgPyAnKDJEIG5vZGUpJyA6ICcoM0Qgbm9kZSknfWAsXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRQcm9wZXJ0aWVzOiB1cGRhdGVzLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlVXVpZDogdXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVUeXBlOiBpczJETm9kZSA/ICcyRCcgOiAnM0QnLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXBwbGllZENoYW5nZXM6IHVwZGF0ZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2Zvcm1Db25zdHJhaW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBpczJETm9kZSA/ICd4LCB5IG9ubHkgKHogaWdub3JlZCknIDogJ3gsIHksIHogYWxsIHVzZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdGF0aW9uOiBpczJETm9kZSA/ICd6IG9ubHkgKHgsIHkgaWdub3JlZCknIDogJ3gsIHksIHogYWxsIHVzZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjYWxlOiBpczJETm9kZSA/ICd4LCB5IG1haW4sIHogdHlwaWNhbGx5IDEnIDogJ3gsIHksIHogYWxsIHVzZWQnXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVJbmZvOiB1cGRhdGVkTm9kZUluZm8uZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zZm9ybURldGFpbHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbE5vZGVUeXBlOiBpczJETm9kZSA/ICcyRCcgOiAnM0QnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwcGxpZWRUcmFuc2Zvcm1zOiB1cGRhdGVzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlQWZ0ZXJDb21wYXJpc29uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYmVmb3JlOiBub2RlSW5mbyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhZnRlcjogdXBkYXRlZE5vZGVJbmZvLmRhdGFcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2Uud2FybmluZyA9IHdhcm5pbmdzLmpvaW4oJzsgJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gdXBkYXRlIHRyYW5zZm9ybTogJHtlcnIubWVzc2FnZX1gIFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGlzMkROb2RlKG5vZGVJbmZvOiBhbnkpOiBib29sZWFuIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgbm9kZSBoYXMgMkQtc3BlY2lmaWMgY29tcG9uZW50cyBvciBpcyB1bmRlciBDYW52YXNcbiAgICAgICAgY29uc3QgY29tcG9uZW50cyA9IG5vZGVJbmZvLmNvbXBvbmVudHMgfHwgW107XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBmb3IgY29tbW9uIDJEIGNvbXBvbmVudHNcbiAgICAgICAgY29uc3QgaGFzMkRDb21wb25lbnRzID0gY29tcG9uZW50cy5zb21lKChjb21wOiBhbnkpID0+IFxuICAgICAgICAgICAgY29tcC50eXBlICYmIChcbiAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLlNwcml0ZScpIHx8XG4gICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5MYWJlbCcpIHx8XG4gICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5CdXR0b24nKSB8fFxuICAgICAgICAgICAgICAgIGNvbXAudHlwZS5pbmNsdWRlcygnY2MuTGF5b3V0JykgfHxcbiAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLldpZGdldCcpIHx8XG4gICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5NYXNrJykgfHxcbiAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLkdyYXBoaWNzJylcbiAgICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChoYXMyRENvbXBvbmVudHMpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBmb3IgM0Qtc3BlY2lmaWMgY29tcG9uZW50cyAgXG4gICAgICAgIGNvbnN0IGhhczNEQ29tcG9uZW50cyA9IGNvbXBvbmVudHMuc29tZSgoY29tcDogYW55KSA9PlxuICAgICAgICAgICAgY29tcC50eXBlICYmIChcbiAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLk1lc2hSZW5kZXJlcicpIHx8XG4gICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5DYW1lcmEnKSB8fFxuICAgICAgICAgICAgICAgIGNvbXAudHlwZS5pbmNsdWRlcygnY2MuTGlnaHQnKSB8fFxuICAgICAgICAgICAgICAgIGNvbXAudHlwZS5pbmNsdWRlcygnY2MuRGlyZWN0aW9uYWxMaWdodCcpIHx8XG4gICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5Qb2ludExpZ2h0JykgfHxcbiAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLlNwb3RMaWdodCcpXG4gICAgICAgICAgICApXG4gICAgICAgICk7XG4gICAgICAgIFxuICAgICAgICBpZiAoaGFzM0RDb21wb25lbnRzKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIERlZmF1bHQgaGV1cmlzdGljOiBpZiB6IHBvc2l0aW9uIGlzIDAgYW5kIGhhc24ndCBiZWVuIGNoYW5nZWQsIGxpa2VseSAyRFxuICAgICAgICBjb25zdCBwb3NpdGlvbiA9IG5vZGVJbmZvLnBvc2l0aW9uO1xuICAgICAgICBpZiAocG9zaXRpb24gJiYgTWF0aC5hYnMocG9zaXRpb24ueikgPCAwLjAwMSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIERlZmF1bHQgdG8gM0QgaWYgdW5jZXJ0YWluXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIG5vcm1hbGl6ZVRyYW5zZm9ybVZhbHVlKHZhbHVlOiBhbnksIHR5cGU6ICdwb3NpdGlvbicgfCAncm90YXRpb24nIHwgJ3NjYWxlJywgaXMyRDogYm9vbGVhbik6IHsgdmFsdWU6IGFueSwgd2FybmluZz86IHN0cmluZyB9IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0geyAuLi52YWx1ZSB9O1xuICAgICAgICBsZXQgd2FybmluZzogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgICBcbiAgICAgICAgaWYgKGlzMkQpIHtcbiAgICAgICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3Bvc2l0aW9uJzpcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbHVlLnogIT09IHVuZGVmaW5lZCAmJiBNYXRoLmFicyh2YWx1ZS56KSA+IDAuMDAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3YXJuaW5nID0gYDJEIG5vZGU6IHogcG9zaXRpb24gKCR7dmFsdWUuen0pIGlnbm9yZWQsIHNldCB0byAwYDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC56ID0gMDtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh2YWx1ZS56ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC56ID0gMDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY2FzZSAncm90YXRpb24nOlxuICAgICAgICAgICAgICAgICAgICBpZiAoKHZhbHVlLnggIT09IHVuZGVmaW5lZCAmJiBNYXRoLmFicyh2YWx1ZS54KSA+IDAuMDAxKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICh2YWx1ZS55ICE9PSB1bmRlZmluZWQgJiYgTWF0aC5hYnModmFsdWUueSkgPiAwLjAwMSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdhcm5pbmcgPSBgMkQgbm9kZTogeCx5IHJvdGF0aW9ucyBpZ25vcmVkLCBvbmx5IHogcm90YXRpb24gYXBwbGllZGA7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQueCA9IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQueSA9IDA7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQueCA9IHJlc3VsdC54IHx8IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQueSA9IHJlc3VsdC55IHx8IDA7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnogPSByZXN1bHQueiB8fCAwO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY2FzZSAnc2NhbGUnOlxuICAgICAgICAgICAgICAgICAgICBpZiAodmFsdWUueiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQueiA9IDE7IC8vIERlZmF1bHQgc2NhbGUgZm9yIDJEXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyAzRCBub2RlIC0gZW5zdXJlIGFsbCBheGVzIGFyZSBkZWZpbmVkXG4gICAgICAgICAgICByZXN1bHQueCA9IHJlc3VsdC54ICE9PSB1bmRlZmluZWQgPyByZXN1bHQueCA6ICh0eXBlID09PSAnc2NhbGUnID8gMSA6IDApO1xuICAgICAgICAgICAgcmVzdWx0LnkgPSByZXN1bHQueSAhPT0gdW5kZWZpbmVkID8gcmVzdWx0LnkgOiAodHlwZSA9PT0gJ3NjYWxlJyA/IDEgOiAwKTtcbiAgICAgICAgICAgIHJlc3VsdC56ID0gcmVzdWx0LnogIT09IHVuZGVmaW5lZCA/IHJlc3VsdC56IDogKHR5cGUgPT09ICdzY2FsZScgPyAxIDogMCk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7IHZhbHVlOiByZXN1bHQsIHdhcm5pbmcgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGRlbGV0ZU5vZGUodXVpZDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdyZW1vdmUtbm9kZScsIHsgdXVpZDogdXVpZCB9KS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ05vZGUgZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgbW92ZU5vZGUobm9kZVV1aWQ6IHN0cmluZywgbmV3UGFyZW50VXVpZDogc3RyaW5nLCBzaWJsaW5nSW5kZXg6IG51bWJlciA9IC0xKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICAvLyBVc2UgY29ycmVjdCBzZXQtcGFyZW50IEFQSSBpbnN0ZWFkIG9mIG1vdmUtbm9kZVxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2V0LXBhcmVudCcsIHtcbiAgICAgICAgICAgICAgICBwYXJlbnQ6IG5ld1BhcmVudFV1aWQsXG4gICAgICAgICAgICAgICAgdXVpZHM6IFtub2RlVXVpZF0sXG4gICAgICAgICAgICAgICAga2VlcFdvcmxkVHJhbnNmb3JtOiBmYWxzZVxuICAgICAgICAgICAgfSkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdOb2RlIG1vdmVkIHN1Y2Nlc3NmdWxseSdcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pLmNhdGNoKChlcnI6IEVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBkdXBsaWNhdGVOb2RlKHV1aWQ6IHN0cmluZywgaW5jbHVkZUNoaWxkcmVuOiBib29sZWFuID0gdHJ1ZSk6IFByb21pc2U8VG9vbFJlc3BvbnNlPiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgLy8gTm90ZTogaW5jbHVkZUNoaWxkcmVuIHBhcmFtZXRlciBpcyBhY2NlcHRlZCBmb3IgZnV0dXJlIHVzZSBidXQgbm90IGN1cnJlbnRseSBpbXBsZW1lbnRlZFxuICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnZHVwbGljYXRlLW5vZGUnLCB1dWlkKS50aGVuKChyZXN1bHQ6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXdVdWlkOiByZXN1bHQudXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdOb2RlIGR1cGxpY2F0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KS5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgZGV0ZWN0Tm9kZVR5cGUodXVpZDogc3RyaW5nKTogUHJvbWlzZTxUb29sUmVzcG9uc2U+IHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5vZGVJbmZvUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmdldE5vZGVJbmZvKHV1aWQpO1xuICAgICAgICAgICAgICAgIGlmICghbm9kZUluZm9SZXNwb25zZS5zdWNjZXNzIHx8ICFub2RlSW5mb1Jlc3BvbnNlLmRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0ZhaWxlZCB0byBnZXQgbm9kZSBpbmZvcm1hdGlvbicgfSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBub2RlSW5mbyA9IG5vZGVJbmZvUmVzcG9uc2UuZGF0YTtcbiAgICAgICAgICAgICAgICBjb25zdCBpczJEID0gdGhpcy5pczJETm9kZShub2RlSW5mbyk7XG4gICAgICAgICAgICAgICAgY29uc3QgY29tcG9uZW50cyA9IG5vZGVJbmZvLmNvbXBvbmVudHMgfHwgW107XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQ29sbGVjdCBkZXRlY3Rpb24gcmVhc29uc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRldGVjdGlvblJlYXNvbnM6IHN0cmluZ1tdID0gW107XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIDJEIGNvbXBvbmVudHNcbiAgICAgICAgICAgICAgICBjb25zdCB0d29EQ29tcG9uZW50cyA9IGNvbXBvbmVudHMuZmlsdGVyKChjb21wOiBhbnkpID0+IFxuICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5TcHJpdGUnKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5MYWJlbCcpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLkJ1dHRvbicpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLkxheW91dCcpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLldpZGdldCcpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLk1hc2snKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5HcmFwaGljcycpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGZvciAzRCBjb21wb25lbnRzXG4gICAgICAgICAgICAgICAgY29uc3QgdGhyZWVEQ29tcG9uZW50cyA9IGNvbXBvbmVudHMuZmlsdGVyKChjb21wOiBhbnkpID0+XG4gICAgICAgICAgICAgICAgICAgIGNvbXAudHlwZSAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLk1lc2hSZW5kZXJlcicpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLkNhbWVyYScpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLkxpZ2h0JykgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXAudHlwZS5pbmNsdWRlcygnY2MuRGlyZWN0aW9uYWxMaWdodCcpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wLnR5cGUuaW5jbHVkZXMoJ2NjLlBvaW50TGlnaHQnKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcC50eXBlLmluY2x1ZGVzKCdjYy5TcG90TGlnaHQnKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgICAgIGlmICh0d29EQ29tcG9uZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbnMucHVzaChgSGFzIDJEIGNvbXBvbmVudHM6ICR7dHdvRENvbXBvbmVudHMubWFwKChjOiBhbnkpID0+IGMudHlwZSkuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKHRocmVlRENvbXBvbmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBkZXRlY3Rpb25SZWFzb25zLnB1c2goYEhhcyAzRCBjb21wb25lbnRzOiAke3RocmVlRENvbXBvbmVudHMubWFwKChjOiBhbnkpID0+IGMudHlwZSkuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgcG9zaXRpb24gZm9yIGhldXJpc3RpY1xuICAgICAgICAgICAgICAgIGNvbnN0IHBvc2l0aW9uID0gbm9kZUluZm8ucG9zaXRpb247XG4gICAgICAgICAgICAgICAgaWYgKHBvc2l0aW9uICYmIE1hdGguYWJzKHBvc2l0aW9uLnopIDwgMC4wMDEpIHtcbiAgICAgICAgICAgICAgICAgICAgZGV0ZWN0aW9uUmVhc29ucy5wdXNoKCdaIHBvc2l0aW9uIGlzIH4wIChsaWtlbHkgMkQpJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwb3NpdGlvbiAmJiBNYXRoLmFicyhwb3NpdGlvbi56KSA+IDAuMDAxKSB7XG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbnMucHVzaChgWiBwb3NpdGlvbiBpcyAke3Bvc2l0aW9uLnp9IChsaWtlbHkgM0QpYCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGRldGVjdGlvblJlYXNvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbnMucHVzaCgnTm8gc3BlY2lmaWMgaW5kaWNhdG9ycyBmb3VuZCwgZGVmYXVsdGluZyBiYXNlZCBvbiBoZXVyaXN0aWNzJyk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGVVdWlkOiB1dWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgbm9kZU5hbWU6IG5vZGVJbmZvLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlVHlwZTogaXMyRCA/ICcyRCcgOiAnM0QnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGV0ZWN0aW9uUmVhc29uczogZGV0ZWN0aW9uUmVhc29ucyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudHM6IGNvbXBvbmVudHMubWFwKChjb21wOiBhbnkpID0+ICh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogY29tcC50eXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhdGVnb3J5OiB0aGlzLmdldENvbXBvbmVudENhdGVnb3J5KGNvbXAudHlwZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvc2l0aW9uOiBub2RlSW5mby5wb3NpdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zZm9ybUNvbnN0cmFpbnRzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zaXRpb246IGlzMkQgPyAneCwgeSBvbmx5ICh6IGlnbm9yZWQpJyA6ICd4LCB5LCB6IGFsbCB1c2VkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3RhdGlvbjogaXMyRCA/ICd6IG9ubHkgKHgsIHkgaWdub3JlZCknIDogJ3gsIHksIHogYWxsIHVzZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjYWxlOiBpczJEID8gJ3gsIHkgbWFpbiwgeiB0eXBpY2FsbHkgMScgOiAneCwgeSwgeiBhbGwgdXNlZCdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHsgXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gZGV0ZWN0IG5vZGUgdHlwZTogJHtlcnIubWVzc2FnZX1gIFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldENvbXBvbmVudENhdGVnb3J5KGNvbXBvbmVudFR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgICAgIGlmICghY29tcG9uZW50VHlwZSkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgXG4gICAgICAgIGlmIChjb21wb25lbnRUeXBlLmluY2x1ZGVzKCdjYy5TcHJpdGUnKSB8fCBjb21wb25lbnRUeXBlLmluY2x1ZGVzKCdjYy5MYWJlbCcpIHx8IFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZS5pbmNsdWRlcygnY2MuQnV0dG9uJykgfHwgY29tcG9uZW50VHlwZS5pbmNsdWRlcygnY2MuTGF5b3V0JykgfHxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGUuaW5jbHVkZXMoJ2NjLldpZGdldCcpIHx8IGNvbXBvbmVudFR5cGUuaW5jbHVkZXMoJ2NjLk1hc2snKSB8fFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZS5pbmNsdWRlcygnY2MuR3JhcGhpY3MnKSkge1xuICAgICAgICAgICAgcmV0dXJuICcyRCc7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChjb21wb25lbnRUeXBlLmluY2x1ZGVzKCdjYy5NZXNoUmVuZGVyZXInKSB8fCBjb21wb25lbnRUeXBlLmluY2x1ZGVzKCdjYy5DYW1lcmEnKSB8fFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZS5pbmNsdWRlcygnY2MuTGlnaHQnKSB8fCBjb21wb25lbnRUeXBlLmluY2x1ZGVzKCdjYy5EaXJlY3Rpb25hbExpZ2h0JykgfHxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGUuaW5jbHVkZXMoJ2NjLlBvaW50TGlnaHQnKSB8fCBjb21wb25lbnRUeXBlLmluY2x1ZGVzKCdjYy5TcG90TGlnaHQnKSkge1xuICAgICAgICAgICAgcmV0dXJuICczRCc7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiAnZ2VuZXJpYyc7XG4gICAgfVxufSJdfQ==