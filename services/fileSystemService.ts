
import { FileSystemState, FileSystemNode } from "../types";

// Default FS Structure
export const createDefaultFileSystem = (): FileSystemState => {
    return {
        root: {
            name: "root",
            type: "dir",
            children: {
                "home": {
                    name: "home",
                    type: "dir",
                    children: {
                        "user": {
                            name: "user",
                            type: "dir",
                            children: {
                                "readme.txt": {
                                    name: "readme.txt",
                                    type: "file",
                                    content: "Welcome to the AI Nexus Terminal.\nAll commands require approval."
                                }
                            }
                        }
                    }
                },
                "var": { name: "var", type: "dir", children: { "log": { name: "log", type: "dir", children: {} } } },
                "tmp": { name: "tmp", type: "dir", children: {} }
            }
        },
        currentPath: "/home/user",
        commandHistory: []
    };
};

// Helper to traverse path
const getNodeByPath = (root: FileSystemNode, pathStr: string, currentPath: string): FileSystemNode | null => {
    if (pathStr === "/") return root;
    
    // Normalize path
    let targetPath = pathStr;
    if (!targetPath.startsWith("/")) {
        // Relative path
        targetPath = currentPath === "/" ? `/${pathStr}` : `${currentPath}/${pathStr}`;
    }
    
    // Handle .. and .
    const parts = targetPath.split("/").filter(p => p !== "" && p !== ".");
    const resolvedParts: string[] = [];
    
    for (const part of parts) {
        if (part === "..") {
            resolvedParts.pop();
        } else {
            resolvedParts.push(part);
        }
    }

    let current = root;
    for (const part of resolvedParts) {
        if (current.type !== "dir" || !current.children || !current.children[part]) {
            return null;
        }
        current = current.children[part];
    }
    return current;
};

export const executeCommand = (state: FileSystemState, commandLine: string): { output: string, newState: FileSystemState } => {
    const args = commandLine.trim().split(/\s+/);
    const cmd = args[0];
    const params = args.slice(1);
    
    let newState = JSON.parse(JSON.stringify(state)); // Deep copy for immutability
    let output = "";

    const getCurrentDir = () => getNodeByPath(newState.root, newState.currentPath, newState.currentPath);

    switch (cmd) {
        case "pwd":
            output = newState.currentPath;
            break;

        case "ls":
            const targetNode = params.length > 0 
                ? getNodeByPath(newState.root, params[0], newState.currentPath)
                : getCurrentDir();
            
            if (!targetNode) {
                output = `ls: cannot access '${params[0]}': No such file or directory`;
            } else if (targetNode.type === "file") {
                output = targetNode.name;
            } else if (targetNode.children) {
                output = Object.keys(targetNode.children).join("  ");
            }
            break;

        case "cd":
            if (params.length === 0) {
                newState.currentPath = "/home/user";
            } else {
                const dest = params[0];
                const node = getNodeByPath(newState.root, dest, newState.currentPath);
                if (!node) {
                    output = `cd: ${dest}: No such file or directory`;
                } else if (node.type !== "dir") {
                    output = `cd: ${dest}: Not a directory`;
                } else {
                    // Resolve absolute path string
                    let newPath = dest.startsWith('/') ? dest : (newState.currentPath === '/' ? `/${dest}` : `${newState.currentPath}/${dest}`);
                    // Normalize (simple)
                    const parts = newPath.split('/').filter(p => p !== '' && p !== '.');
                    const stack: string[] = [];
                    for(const p of parts) {
                        if(p === '..') stack.pop();
                        else stack.push(p);
                    }
                    newState.currentPath = '/' + stack.join('/') || '/';
                }
            }
            break;

        case "cat":
            if (params.length === 0) {
                output = "cat: missing file operand";
            } else {
                const node = getNodeByPath(newState.root, params[0], newState.currentPath);
                if (!node) output = `cat: ${params[0]}: No such file or directory`;
                else if (node.type === "dir") output = `cat: ${params[0]}: Is a directory`;
                else output = node.content || "";
            }
            break;

        case "echo":
            // Handle simple echo "text" > file
            const redirectIndex = params.indexOf(">");
            if (redirectIndex !== -1) {
                const text = params.slice(0, redirectIndex).join(" ").replace(/^"|"$/g, '');
                const fileName = params[redirectIndex + 1];
                if (!fileName) {
                    output = "bash: syntax error near unexpected token `newline'";
                } else {
                    // Write to file
                    let targetPath = fileName.startsWith('/') ? fileName : (newState.currentPath === '/' ? `/${fileName}` : `${newState.currentPath}/${fileName}`);
                    const pathParts = targetPath.split('/');
                    const file = pathParts.pop()!;
                    const dirPath = pathParts.join('/') || "/";
                    
                    const dirNode = getNodeByPath(newState.root, dirPath, newState.currentPath);
                    if (!dirNode || dirNode.type !== 'dir') {
                        output = `bash: ${fileName}: No such file or directory`;
                    } else {
                        if (!dirNode.children) dirNode.children = {};
                        dirNode.children[file] = { name: file, type: 'file', content: text };
                    }
                }
            } else {
                output = params.join(" ").replace(/^"|"$/g, '');
            }
            break;

        case "touch":
            if (params.length === 0) {
                output = "touch: missing file operand";
            } else {
                const fileName = params[0];
                const currentDir = getCurrentDir();
                if (currentDir && currentDir.children) {
                    if (!currentDir.children[fileName]) {
                        currentDir.children[fileName] = { name: fileName, type: "file", content: "" };
                    }
                }
            }
            break;

        case "mkdir":
            if (params.length === 0) {
                output = "mkdir: missing operand";
            } else {
                const dirName = params[0];
                const currentDir = getCurrentDir();
                if (currentDir && currentDir.children) {
                    if (currentDir.children[dirName]) {
                        output = `mkdir: cannot create directory '${dirName}': File exists`;
                    } else {
                        currentDir.children[dirName] = { name: dirName, type: "dir", children: {} };
                    }
                }
            }
            break;
            
        case "rm":
            if (params.length === 0) {
                output = "rm: missing operand";
            } else {
                // Ignore flags like -rf for simplicity in simulation
                const targetName = params.filter(p => !p.startsWith('-'))[0];
                if (!targetName) {
                     output = "rm: missing operand";
                } else {
                    const currentDir = getCurrentDir();
                    if (currentDir && currentDir.children && currentDir.children[targetName]) {
                        delete currentDir.children[targetName];
                    } else {
                        output = `rm: cannot remove '${targetName}': No such file or directory`;
                    }
                }
            }
            break;

        case "whoami":
            output = "restricted_user";
            break;

        case "":
            break;

        default:
            output = `${cmd}: command not found`;
    }

    newState.commandHistory.push(commandLine);
    return { output, newState };
};
