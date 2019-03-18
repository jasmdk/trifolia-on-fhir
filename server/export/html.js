"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const log4js = require("log4js");
const path = require("path");
const _ = require("underscore");
const rp = require("request-promise");
const fs = require("fs-extra");
const config = require("config");
const tmp = require("tmp");
const vkbeautify = require("vkbeautify");
const bundle_1 = require("./bundle");
const globals_1 = require("../../src/app/globals");
const fhirConfig = config.get('fhir');
const serverConfig = config.get('server');
class HtmlExporter {
    constructor(fhirServerBase, fhirServerId, fhirVersion, fhir, io, socketId, implementationGuideId) {
        this.log = log4js.getLogger();
        this.fhirServerBase = fhirServerBase;
        this.fhirServerId = fhirServerId;
        this.fhirVersion = fhirVersion;
        this.fhir = fhir;
        this.io = io;
        this.socketId = socketId;
        this.implementationGuideId = implementationGuideId;
    }
    getDisplayName(name) {
        if (!name) {
            return;
        }
        if (typeof name === 'string') {
            return name;
        }
        let display = name.family;
        if (name.given) {
            if (display) {
                display += ', ';
            }
            else {
                display = '';
            }
            display += name.given.join(' ');
        }
        return display;
    }
    createTableFromArray(headers, data) {
        let output = '<table>\n<thead>\n<tr>\n';
        _.each(headers, (header) => {
            output += `<th>${header}</th>\n`;
        });
        output += '</tr>\n</thead>\n<tbody>\n';
        _.each(data, (row) => {
            output += '<tr>\n';
            _.each(row, (cell) => {
                output += `<td>${cell}</td>\n`;
            });
            output += '</tr>\n';
        });
        output += '</tbody>\n</table>\n';
        return output;
    }
    sendSocketMessage(status, message) {
        if (!this.socketId) {
            this.log.error('Won\'t send socket message for export because the original request did not specify a socketId');
            return;
        }
        if (this.io) {
            this.io.to(this.socketId).emit('html-export', {
                packageId: this.packageId,
                status: status,
                message: message
            });
        }
    }
    getIgPublisher(useLatest) {
        return new Promise((resolve) => {
            const fileName = 'org.hl7.fhir.igpublisher.jar';
            const defaultPath = path.join(__dirname, '../../ig-publisher');
            const defaultFilePath = path.join(defaultPath, fileName);
            if (useLatest === true) {
                this.log.debug('Request to get latest version of FHIR IG publisher. Retrieving from: ' + fhirConfig.latestPublisher);
                this.sendSocketMessage('progress', 'Downloading latest FHIR IG publisher');
                // TODO: Check http://build.fhir.org/version.info first
                rp(fhirConfig.latestPublisher, { encoding: null })
                    .then((results) => {
                    this.log.debug('Successfully downloaded latest version of FHIR IG Publisher. Ensuring latest directory exists');
                    const latestPath = path.join(defaultPath, 'latest');
                    fs.ensureDirSync(latestPath);
                    // noinspection JSUnresolvedFunction
                    const buff = Buffer.from(results, 'utf8');
                    const latestFilePath = path.join(latestPath, fileName);
                    this.log.debug('Saving FHIR IG publisher to ' + latestFilePath);
                    fs.writeFileSync(latestFilePath, buff);
                    resolve(latestFilePath);
                })
                    .catch((err) => {
                    this.log.error(`Error getting latest version of FHIR IG publisher: ${err}`);
                    this.sendSocketMessage('progress', 'Encountered error downloading latest IG publisher, will use pre-loaded/default IG publisher');
                    resolve(defaultFilePath);
                });
            }
            else {
                this.log.debug('Using built-in version of FHIR IG publisher for export');
                this.sendSocketMessage('progress', 'Using existing/default version of FHIR IG publisher');
                resolve(defaultFilePath);
            }
        });
    }
    copyExtension(destExtensionsDir, extensionFileName, isXml, fhir) {
        const sourceExtensionsDir = path.join(__dirname, '../../src/assets/stu3/extensions');
        const sourceExtensionFileName = path.join(sourceExtensionsDir, extensionFileName);
        let destExtensionFileName = path.join(destExtensionsDir, extensionFileName);
        if (!isXml) {
            fs.copySync(sourceExtensionFileName, destExtensionFileName);
        }
        else {
            const extensionJson = fs.readFileSync(sourceExtensionFileName).toString();
            const extensionXml = fhir.jsonToXml(extensionJson);
            destExtensionFileName = destExtensionFileName.substring(0, destExtensionFileName.indexOf('.json')) + '.xml';
            fs.writeFileSync(destExtensionFileName, extensionXml);
        }
    }
    getDependencies(control, isXml, resourcesDir, fhir, fhirServerConfig) {
        const isStu3 = fhirServerConfig && fhirServerConfig.version === 'stu3';
        // Load the ig dependency extensions into the resources directory
        if (isStu3 && control.dependencyList && control.dependencyList.length > 0) {
            const destExtensionsDir = path.join(resourcesDir, 'structuredefinition');
            fs.ensureDirSync(destExtensionsDir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency.json', isXml, fhir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency-version.json', isXml, fhir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency-location.json', isXml, fhir);
            this.copyExtension(destExtensionsDir, 'extension-ig-dependency-name.json', isXml, fhir);
        }
        return Promise.resolve([]); // This isn't actually needed, since the IG Publisher attempts to resolve these dependency automatically
        /*
        // Attempt to resolve the dependency's definitions and include it in the package
        const deferred = Q.defer();
        const promises = _.map(control.dependencyList, (dependency) => {
            const dependencyUrl =
                dependency.location +
                (dependency.location.endsWith('/') ? '' : '/') + 'definitions.' +
                (isXml ? 'xml' : 'json') +
                '.zip';
            return getDependency(dependencyUrl, dependency.name);
        });
    
        Q.all(promises)
            .then(deferred.resolve)
            .catch(deferred.reject);
    
        return deferred.promise;
        */
    }
    getFhirControlVersion(fhirServerConfig) {
        const configVersion = fhirServerConfig ? fhirServerConfig.version : null;
        // TODO: Add more logic
        switch (configVersion) {
            case 'stu3':
                return '3.0.1';
            default:
                return '4.0.0';
        }
    }
    updateTemplates(rootPath, bundle, implementationGuide) {
        const mainResourceTypes = ['ImplementationGuide', 'ValueSet', 'CodeSystem', 'StructureDefinition', 'CapabilityStatement'];
        const distinctResources = _.chain(bundle.entry)
            .map((entry) => entry.resource)
            .uniq((resource) => resource.id)
            .value();
        const valueSets = _.filter(distinctResources, (resource) => resource.resourceType === 'ValueSet');
        const codeSystems = _.filter(distinctResources, (resource) => resource.resourceType === 'CodeSystem');
        const profiles = _.filter(distinctResources, (resource) => resource.resourceType === 'StructureDefinition' && (!resource.baseDefinition || !resource.baseDefinition.endsWith('Extension')));
        const extensions = _.filter(distinctResources, (resource) => resource.resourceType === 'StructureDefinition' && resource.baseDefinition && resource.baseDefinition.endsWith('Extension'));
        const capabilityStatements = _.filter(distinctResources, (resource) => resource.resourceType === 'CapabilityStatement');
        const otherResources = _.filter(distinctResources, (resource) => mainResourceTypes.indexOf(resource.resourceType) < 0);
        if (implementationGuide) {
            const indexPath = path.join(rootPath, 'source/pages/index.md');
            if (implementationGuide.description) {
                const descriptionContent = '### Description\n\n' + implementationGuide.description + '\n\n';
                fs.appendFileSync(indexPath, descriptionContent);
            }
            if (implementationGuide.contact) {
                const authorsData = _.map(implementationGuide.contact, (contact) => {
                    const foundEmail = _.find(contact.telecom, (telecom) => telecom.system === 'email');
                    return [contact.name, foundEmail ? `<a href="mailto:${foundEmail.value}">${foundEmail.value}</a>` : ''];
                });
                const authorsContent = '### Authors\n\n' + this.createTableFromArray(['Name', 'Email'], authorsData) + '\n\n';
                fs.appendFileSync(indexPath, authorsContent);
            }
        }
        if (profiles.length > 0) {
            const profilesData = _.chain(profiles)
                .sortBy((profile) => profile.name)
                .map((profile) => {
                return [`<a href="StructureDefinition-${profile.id}.html">${profile.name}</a>`, profile.description || ''];
            }).value();
            const profilesTable = this.createTableFromArray(['Name', 'Description'], profilesData);
            const profilesPath = path.join(rootPath, 'source/pages/profiles.md');
            fs.appendFileSync(profilesPath, '### Profiles\n\n' + profilesTable + '\n\n');
        }
        if (extensions.length > 0) {
            const extData = _.chain(extensions)
                .sortBy((extension) => extension.name)
                .map((extension) => {
                return [`<a href="StructureDefinition-${extension.id}.html">${extension.name}</a>`, extension.description || ''];
            }).value();
            const extContent = this.createTableFromArray(['Name', 'Description'], extData);
            const extPath = path.join(rootPath, 'source/pages/profiles.md');
            fs.appendFileSync(extPath, '### Extensions\n\n' + extContent + '\n\n');
        }
        if (valueSets.length > 0) {
            let vsContent = '### Value Sets\n\n';
            const vsPath = path.join(rootPath, 'source/pages/terminology.md');
            _.chain(valueSets)
                .sortBy((valueSet) => valueSet.title || valueSet.name)
                .each((valueSet) => {
                vsContent += `- [${valueSet.title || valueSet.name}](ValueSet-${valueSet.id}.html)\n`;
            });
            fs.appendFileSync(vsPath, vsContent + '\n\n');
        }
        if (codeSystems.length > 0) {
            let csContent = '### Code Systems\n\n';
            const csPath = path.join(rootPath, 'source/pages/terminology.md');
            _.chain(codeSystems)
                .sortBy((codeSystem) => codeSystem.title || codeSystem.name)
                .each((codeSystem) => {
                csContent += `- [${codeSystem.title || codeSystem.name}](ValueSet-${codeSystem.id}.html)\n`;
            });
            fs.appendFileSync(csPath, csContent + '\n\n');
        }
        if (capabilityStatements.length > 0) {
            const csData = _.chain(capabilityStatements)
                .sortBy((capabilityStatement) => capabilityStatement.name)
                .map((capabilityStatement) => {
                return [`<a href="CapabilityStatement-${capabilityStatement.id}.html">${capabilityStatement.name}</a>`, capabilityStatement.description || ''];
            }).value();
            const csContent = this.createTableFromArray(['Name', 'Description'], csData);
            const csPath = path.join(rootPath, 'source/pages/capstatements.md');
            fs.appendFileSync(csPath, '### CapabilityStatements\n\n' + csContent);
        }
        if (otherResources.length > 0) {
            const oData = _.chain(otherResources)
                .sortBy((resource) => {
                let display = resource.title || this.getDisplayName(resource.name) || resource.id;
                return resource.resourceType + display;
            })
                .map((resource) => {
                let name = resource.title || this.getDisplayName(resource.name) || resource.id;
                return [resource.resourceType, `<a href="${resource.resourceType}-${resource.id}.html">${name}</a>`];
            })
                .value();
            const oContent = this.createTableFromArray(['Type', 'Name'], oData);
            const csPath = path.join(rootPath, 'source/pages/other.md');
            fs.appendFileSync(csPath, '### Other Resources\n\n' + oContent);
        }
    }
    writeFilesForResources(rootPath, resource) {
        if (!resource || !resource.resourceType || resource.resourceType === 'ImplementationGuide') {
            return;
        }
        const introPath = path.join(rootPath, `source/pages/_includes/${resource.id}-intro.md`);
        const searchPath = path.join(rootPath, `source/pages/_includes/${resource.id}-search.md`);
        const summaryPath = path.join(rootPath, `source/pages/_includes/${resource.id}-summary.md`);
        let intro = '---\n' +
            `title: ${resource.resourceType}-${resource.id}-intro\n` +
            'layout: default\n' +
            `active: ${resource.resourceType}-${resource.id}-intro\n` +
            '---\n\n';
        if (resource.description) {
            intro += resource.description;
        }
        fs.writeFileSync(introPath, intro);
        fs.writeFileSync(searchPath, 'TODO - Search');
        fs.writeFileSync(summaryPath, 'TODO - Summary');
    }
    getStu3Control(implementationGuide, bundle, version) {
        const canonicalBaseRegex = /^(.+?)\/ImplementationGuide\/.+$/gm;
        const canonicalBaseMatch = canonicalBaseRegex.exec(implementationGuide.url);
        const packageIdExtension = _.find(implementationGuide.extension, (extension) => extension.url === globals_1.Globals.extensionUrls['extension-ig-package-id']);
        let canonicalBase;
        if (!canonicalBaseMatch || canonicalBaseMatch.length < 2) {
            canonicalBase = implementationGuide.url.substring(0, implementationGuide.url.lastIndexOf('/'));
        }
        else {
            canonicalBase = canonicalBaseMatch[1];
        }
        // TODO: Extract npm-name from IG extension.
        // currently, IG resource has to be in XML format for the IG Publisher
        const control = {
            tool: 'jekyll',
            source: 'implementationguide/' + implementationGuide.id + '.xml',
            'npm-name': packageIdExtension && packageIdExtension.valueString ? packageIdExtension.valueString : implementationGuide.id + '-npm',
            license: 'CC0-1.0',
            paths: {
                qa: 'generated_output/qa',
                temp: 'generated_output/temp',
                output: 'output',
                txCache: 'generated_output/txCache',
                specification: 'http://hl7.org/fhir/STU3',
                pages: [
                    'framework',
                    'source/pages'
                ],
                resources: ['source/resources']
            },
            pages: ['pages'],
            'extension-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'allowed-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'sct-edition': 'http://snomed.info/sct/731000124108',
            canonicalBase: canonicalBase,
            defaults: {
                'Location': { 'template-base': 'ex.html' },
                'ProcedureRequest': { 'template-base': 'ex.html' },
                'Organization': { 'template-base': 'ex.html' },
                'MedicationStatement': { 'template-base': 'ex.html' },
                'SearchParameter': { 'template-base': 'base.html' },
                'StructureDefinition': {
                    'template-mappings': 'sd-mappings.html',
                    'template-base': 'sd.html',
                    'template-defns': 'sd-definitions.html'
                },
                'Immunization': { 'template-base': 'ex.html' },
                'Patient': { 'template-base': 'ex.html' },
                'StructureMap': {
                    'content': false,
                    'script': false,
                    'template-base': 'ex.html',
                    'profiles': false
                },
                'ConceptMap': { 'template-base': 'base.html' },
                'Practitioner': { 'template-base': 'ex.html' },
                'OperationDefinition': { 'template-base': 'base.html' },
                'CodeSystem': { 'template-base': 'base.html' },
                'Communication': { 'template-base': 'ex.html' },
                'Any': {
                    'template-format': 'format.html',
                    'template-base': 'base.html'
                },
                'PractitionerRole': { 'template-base': 'ex.html' },
                'ValueSet': { 'template-base': 'base.html' },
                'CapabilityStatement': { 'template-base': 'base.html' },
                'Observation': { 'template-base': 'ex.html' }
            },
            resources: {}
        };
        if (version) {
            control.version = version;
        }
        // Set the dependencyList based on the extensions in the IG
        const dependencyExtensions = _.filter(implementationGuide.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency');
        // R4 ImplementationGuide.dependsOn
        control.dependencyList = _.chain(dependencyExtensions)
            .filter((dependencyExtension) => {
            const locationExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-location');
            const nameExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-name');
            return !!locationExtension && !!locationExtension.valueString && !!nameExtension && !!nameExtension.valueString;
        })
            .map((dependencyExtension) => {
            const locationExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-location');
            const nameExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-name');
            const versionExtension = _.find(dependencyExtension.extension, (next) => next.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-dependency-version');
            return {
                location: locationExtension ? locationExtension.valueUri : '',
                name: nameExtension ? nameExtension.valueString : '',
                version: versionExtension ? versionExtension.valueString : ''
            };
        })
            .value();
        // Define the resources in the control and what templates they should use
        if (bundle && bundle.entry) {
            for (let i = 0; i < bundle.entry.length; i++) {
                const entry = bundle.entry[i];
                const resource = entry.resource;
                if (resource.resourceType === 'ImplementationGuide') {
                    continue;
                }
                control.resources[resource.resourceType + '/' + resource.id] = {
                    base: resource.resourceType + '-' + resource.id + '.html',
                    defns: resource.resourceType + '-' + resource.id + '-definitions.html'
                };
            }
        }
        return control;
    }
    getR4Control(implementationGuide, bundle, version) {
        const canonicalBaseRegex = /^(.+?)\/ImplementationGuide\/.+$/gm;
        const canonicalBaseMatch = canonicalBaseRegex.exec(implementationGuide.url);
        let canonicalBase;
        if (!canonicalBaseMatch || canonicalBaseMatch.length < 2) {
            canonicalBase = implementationGuide.url.substring(0, implementationGuide.url.lastIndexOf('/'));
        }
        else {
            canonicalBase = canonicalBaseMatch[1];
        }
        // currently, IG resource has to be in XML format for the IG Publisher
        const control = {
            tool: 'jekyll',
            source: 'implementationguide/' + implementationGuide.id + '.xml',
            'npm-name': implementationGuide.packageId || implementationGuide.id + '-npm',
            license: implementationGuide.license || 'CC0-1.0',
            paths: {
                qa: 'generated_output/qa',
                temp: 'generated_output/temp',
                output: 'output',
                txCache: 'generated_output/txCache',
                specification: 'http://hl7.org/fhir/R4/',
                pages: [
                    'framework',
                    'source/pages'
                ],
                resources: ['source/resources']
            },
            pages: ['pages'],
            'extension-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'allowed-domains': ['https://trifolia-on-fhir.lantanagroup.com'],
            'sct-edition': 'http://snomed.info/sct/731000124108',
            canonicalBase: canonicalBase,
            defaults: {
                'Location': { 'template-base': 'ex.html' },
                'ProcedureRequest': { 'template-base': 'ex.html' },
                'Organization': { 'template-base': 'ex.html' },
                'MedicationStatement': { 'template-base': 'ex.html' },
                'SearchParameter': { 'template-base': 'base.html' },
                'StructureDefinition': {
                    'template-mappings': 'sd-mappings.html',
                    'template-base': 'sd.html',
                    'template-defns': 'sd-definitions.html'
                },
                'Immunization': { 'template-base': 'ex.html' },
                'Patient': { 'template-base': 'ex.html' },
                'StructureMap': {
                    'content': false,
                    'script': false,
                    'template-base': 'ex.html',
                    'profiles': false
                },
                'ConceptMap': { 'template-base': 'base.html' },
                'Practitioner': { 'template-base': 'ex.html' },
                'OperationDefinition': { 'template-base': 'base.html' },
                'CodeSystem': { 'template-base': 'base.html' },
                'Communication': { 'template-base': 'ex.html' },
                'Any': {
                    'template-format': 'format.html',
                    'template-base': 'base.html'
                },
                'PractitionerRole': { 'template-base': 'ex.html' },
                'ValueSet': { 'template-base': 'base.html' },
                'CapabilityStatement': { 'template-base': 'base.html' },
                'Observation': { 'template-base': 'ex.html' }
            },
            resources: {}
        };
        if (version) {
            control.version = version;
        }
        if (implementationGuide.fhirVersion && implementationGuide.fhirVersion.length > 0) {
            control['fixed-business-version'] = implementationGuide.fhirVersion[0];
        }
        control.dependencyList = _.chain(implementationGuide.dependsOn)
            .filter((dependsOn) => {
            const locationExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-location');
            const nameExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-name');
            return !!locationExtension && !!locationExtension.valueString && !!nameExtension && !!nameExtension.valueString;
        })
            .map((dependsOn) => {
            const locationExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-location');
            const nameExtension = _.find(dependsOn.extension, (dependencyExtension) => dependencyExtension.url === 'https://trifolia-fhir.lantanagroup.com/r4/StructureDefinition/extension-ig-depends-on-name');
            return {
                location: locationExtension ? locationExtension.valueString : '',
                name: nameExtension ? nameExtension.valueString : '',
                version: dependsOn.version
            };
        })
            .value();
        // Define the resources in the control and what templates they should use
        if (bundle && bundle.entry) {
            for (let i = 0; i < bundle.entry.length; i++) {
                const entry = bundle.entry[i];
                const resource = entry.resource;
                if (resource.resourceType === 'ImplementationGuide') {
                    continue;
                }
                control.resources[resource.resourceType + '/' + resource.id] = {
                    base: resource.resourceType + '-' + resource.id + '.html',
                    defns: resource.resourceType + '-' + resource.id + '-definitions.html'
                };
            }
        }
        return control;
    }
    getStu3PageContent(implementationGuide, page) {
        const contentExtension = _.find(page.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-page-content');
        if (contentExtension && contentExtension.valueReference && contentExtension.valueReference.reference && page.source) {
            const reference = contentExtension.valueReference.reference;
            if (reference.startsWith('#')) {
                const contained = _.find(implementationGuide.contained, (contained) => contained.id === reference.substring(1));
                const binary = contained && contained.resourceType === 'Binary' ? contained : undefined;
                if (binary) {
                    return {
                        fileName: page.source,
                        content: Buffer.from(binary.content, 'base64').toString()
                    };
                }
            }
        }
    }
    writeStu3Page(pagesPath, implementationGuide, page, level, tocEntries) {
        const pageContent = this.getStu3PageContent(implementationGuide, page);
        if (page.kind !== 'toc' && pageContent && pageContent.content) {
            const newPagePath = path.join(pagesPath, pageContent.fileName);
            const content = '---\n' +
                `title: ${page.title}\n` +
                'layout: default\n' +
                `active: ${page.title}\n` +
                '---\n\n' + pageContent.content;
            fs.writeFileSync(newPagePath, content);
        }
        // Add an entry to the TOC
        tocEntries.push({ level: level, fileName: page.kind === 'page' && pageContent ? pageContent.fileName : null, title: page.title });
        _.each(page.page, (subPage) => this.writeStu3Page(pagesPath, implementationGuide, subPage, level + 1, tocEntries));
    }
    getPageExtension(page) {
        switch (page.generation) {
            case 'html':
            case 'generated':
                return '.html';
            case 'xml':
                return '.xml';
            default:
                return '.md';
        }
    }
    writeR4Page(pagesPath, implementationGuide, page, level, tocEntries) {
        let fileName;
        if (page.nameReference && page.nameReference.reference && page.title) {
            const reference = page.nameReference.reference;
            if (reference.startsWith('#')) {
                const contained = _.find(implementationGuide.contained, (contained) => contained.id === reference.substring(1));
                const binary = contained && contained.resourceType === 'Binary' ? contained : undefined;
                if (binary && binary.data) {
                    fileName = page.title.replace(/ /g, '_');
                    if (fileName.indexOf('.') < 0) {
                        fileName += this.getPageExtension(page);
                    }
                    const newPagePath = path.join(pagesPath, fileName);
                    // noinspection JSUnresolvedFunction
                    const binaryContent = Buffer.from(binary.data, 'base64').toString();
                    const content = '---\n' +
                        `title: ${page.title}\n` +
                        'layout: default\n' +
                        `active: ${page.title}\n` +
                        `---\n\n${binaryContent}`;
                    fs.writeFileSync(newPagePath, content);
                }
            }
        }
        // Add an entry to the TOC
        tocEntries.push({ level: level, fileName: fileName, title: page.title });
        _.each(page.page, (subPage) => this.writeR4Page(pagesPath, implementationGuide, subPage, level + 1, tocEntries));
    }
    generateTableOfContents(rootPath, tocEntries, shouldAutoGenerate, pageContent) {
        const tocPath = path.join(rootPath, 'source/pages/toc.md');
        let tocContent = '';
        if (shouldAutoGenerate) {
            _.each(tocEntries, (entry) => {
                let fileName = entry.fileName;
                if (fileName && fileName.endsWith('.md')) {
                    fileName = fileName.substring(0, fileName.length - 3) + '.html';
                }
                for (let i = 1; i < entry.level; i++) {
                    tocContent += '    ';
                }
                tocContent += '* ';
                if (fileName) {
                    tocContent += `<a href="${fileName}">${entry.title}</a>\n`;
                }
                else {
                    tocContent += `${entry.title}\n`;
                }
            });
        }
        else if (pageContent && pageContent.content) {
            tocContent = pageContent.content;
        }
        if (tocContent) {
            fs.appendFileSync(tocPath, tocContent);
        }
    }
    writeStu3Pages(rootPath, implementationGuide) {
        const tocFilePath = path.join(rootPath, 'source/pages/toc.md');
        const tocEntries = [];
        if (implementationGuide.page) {
            const autoGenerateExtension = _.find(implementationGuide.page.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-page-auto-generate-toc');
            const shouldAutoGenerate = autoGenerateExtension && autoGenerateExtension.valueBoolean === true;
            const pageContent = this.getStu3PageContent(implementationGuide, implementationGuide.page);
            const pagesPath = path.join(rootPath, 'source/pages');
            fs.ensureDirSync(pagesPath);
            this.writeStu3Page(pagesPath, implementationGuide, implementationGuide.page, 1, tocEntries);
            this.generateTableOfContents(rootPath, tocEntries, shouldAutoGenerate, pageContent);
        }
    }
    writeR4Pages(rootPath, implementationGuide) {
        const tocEntries = [];
        let shouldAutoGenerate = true;
        let rootPageContent;
        let rootPageFileName;
        if (implementationGuide.definition && implementationGuide.definition.page) {
            const autoGenerateExtension = _.find(implementationGuide.definition.page.extension, (extension) => extension.url === 'https://trifolia-on-fhir.lantanagroup.com/StructureDefinition/extension-ig-page-auto-generate-toc');
            shouldAutoGenerate = autoGenerateExtension && autoGenerateExtension.valueBoolean === true;
            const pagesPath = path.join(rootPath, 'source/pages');
            fs.ensureDirSync(pagesPath);
            if (implementationGuide.definition.page.nameReference) {
                const nameReference = implementationGuide.definition.page.nameReference;
                if (nameReference.reference && nameReference.reference.startsWith('#')) {
                    const foundContained = _.find(implementationGuide.contained, (contained) => contained.id === nameReference.reference.substring(1));
                    const binary = foundContained && foundContained.resourceType === 'Binary' ? foundContained : undefined;
                    if (binary) {
                        rootPageContent = new Buffer(binary.data, 'base64').toString();
                        rootPageFileName = implementationGuide.definition.page.title.replace(/ /g, '_');
                        if (!rootPageFileName.endsWith('.md')) {
                            rootPageFileName += '.md';
                        }
                    }
                }
            }
            this.writeR4Page(pagesPath, implementationGuide, implementationGuide.definition.page, 1, tocEntries);
        }
        // Append TOC Entries to the toc.md file in the template
        this.generateTableOfContents(rootPath, tocEntries, shouldAutoGenerate, { fileName: rootPageFileName, content: rootPageContent });
    }
    export(format, executeIgPublisher, useTerminologyServer, useLatest, downloadOutput, includeIgPublisherJar, testCallback) {
        return new Promise((resolve, reject) => {
            const bundleExporter = new bundle_1.BundleExporter(this.fhirServerBase, this.fhirServerId, this.fhirVersion, this.fhir, this.implementationGuideId);
            const isXml = format === 'xml' || format === 'application/xml' || format === 'application/fhir+xml';
            const extension = (!isXml ? '.json' : '.xml');
            const homedir = require('os').homedir();
            const fhirServerConfig = _.find(fhirConfig.servers, (server) => server.id === this.fhirServerId);
            let control;
            let implementationGuideResource;
            tmp.dir((tmpDirErr, rootPath) => {
                if (tmpDirErr) {
                    this.log.error(tmpDirErr);
                    return reject('An error occurred while creating a temporary directory: ' + tmpDirErr);
                }
                const controlPath = path.join(rootPath, 'ig.json');
                let bundle;
                this.packageId = rootPath.substring(rootPath.lastIndexOf(path.sep) + 1);
                resolve(this.packageId);
                setTimeout(() => {
                    this.sendSocketMessage('progress', 'Created temp directory. Retrieving resources for implementation guide.');
                    // Prepare IG Publisher package
                    bundleExporter.getBundle(false)
                        .then((results) => {
                        bundle = results;
                        const resourcesDir = path.join(rootPath, 'source/resources');
                        this.sendSocketMessage('progress', 'Resources retrieved. Packaging.');
                        for (let i = 0; i < bundle.entry.length; i++) {
                            const resource = bundle.entry[i].resource;
                            const cleanResource = bundle_1.BundleExporter.cleanupResource(resource);
                            const resourceType = resource.resourceType;
                            const id = resource.id;
                            const resourceDir = path.join(resourcesDir, resourceType.toLowerCase());
                            let resourcePath;
                            let resourceContent = null;
                            if (resourceType === 'ImplementationGuide' && id === this.implementationGuideId) {
                                implementationGuideResource = resource;
                            }
                            // ImplementationGuide must be generated as an xml file for the IG Publisher in STU3.
                            if (!isXml && resourceType !== 'ImplementationGuide') {
                                resourceContent = JSON.stringify(cleanResource, null, '\t');
                                resourcePath = path.join(resourceDir, id + '.json');
                            }
                            else {
                                resourceContent = this.fhir.objToXml(cleanResource);
                                resourceContent = vkbeautify.xml(resourceContent);
                                resourcePath = path.join(resourceDir, id + '.xml');
                            }
                            fs.ensureDirSync(resourceDir);
                            fs.writeFileSync(resourcePath, resourceContent);
                        }
                        if (!implementationGuideResource) {
                            throw new Error('The implementation guide was not found in the bundle returned by the server');
                        }
                        if (fhirServerConfig.version === 'stu3') {
                            control = this.getStu3Control(implementationGuideResource, bundle, this.getFhirControlVersion(fhirServerConfig));
                        }
                        else {
                            control = this.getR4Control(implementationGuideResource, bundle, this.getFhirControlVersion(fhirServerConfig));
                        }
                        return this.getDependencies(control, isXml, resourcesDir, this.fhir, fhirServerConfig);
                    })
                        .then(() => {
                        // Copy the contents of the ig-publisher-template folder to the export temporary folder
                        const templatePath = path.join(__dirname, '../../', 'ig-publisher-template');
                        fs.copySync(templatePath, rootPath);
                        // Write the ig.json file to the export temporary folder
                        const controlContent = JSON.stringify(control, null, '\t');
                        fs.writeFileSync(controlPath, controlContent);
                        // Write the intro, summary and search MD files for each resource
                        _.each(bundle.entry, (entry) => this.writeFilesForResources(rootPath, entry.resource));
                        this.updateTemplates(rootPath, bundle, implementationGuideResource);
                        if (fhirServerConfig.version === 'stu3') {
                            this.writeStu3Pages(rootPath, implementationGuideResource);
                        }
                        else {
                            this.writeR4Pages(rootPath, implementationGuideResource);
                        }
                        this.sendSocketMessage('progress', 'Done building package');
                        return this.getIgPublisher(useLatest);
                    })
                        .then((igPublisherLocation) => {
                        if (includeIgPublisherJar && igPublisherLocation) {
                            this.sendSocketMessage('progress', 'Copying IG Publisher JAR to working directory.');
                            const jarFileName = igPublisherLocation.substring(igPublisherLocation.lastIndexOf(path.sep) + 1);
                            const destJarPath = path.join(rootPath, jarFileName);
                            fs.copySync(igPublisherLocation, destJarPath);
                        }
                        if (!executeIgPublisher || !igPublisherLocation) {
                            this.sendSocketMessage('complete', 'Done. You will be prompted to download the package in a moment.');
                            if (testCallback) {
                                testCallback(rootPath);
                            }
                            return;
                        }
                        const deployDir = path.resolve(__dirname, '../../wwwroot/igs', this.fhirServerId, implementationGuideResource.id);
                        fs.ensureDirSync(deployDir);
                        const igPublisherVersion = useLatest ? 'latest' : 'default';
                        const process = serverConfig.javaLocation || 'java';
                        const jarParams = ['-jar', igPublisherLocation, '-ig', controlPath];
                        if (!useTerminologyServer) {
                            jarParams.push('-tx', 'N/A');
                        }
                        this.sendSocketMessage('progress', `Running ${igPublisherVersion} IG Publisher: ${jarParams.join(' ')}`);
                        this.log.debug(`Spawning FHIR IG Publisher Java process at ${process} with params ${jarParams}`);
                        const igPublisherProcess = child_process_1.spawn(process, jarParams);
                        igPublisherProcess.stdout.on('data', (data) => {
                            const message = data.toString().replace(tmp.tmpdir, 'XXX').replace(homedir, 'XXX');
                            if (message && message.trim().replace(/\./g, '') !== '') {
                                this.sendSocketMessage('progress', message);
                            }
                        });
                        igPublisherProcess.stderr.on('data', (data) => {
                            const message = data.toString().replace(tmp.tmpdir, 'XXX').replace(homedir, 'XXX');
                            if (message && message.trim().replace(/\./g, '') !== '') {
                                this.sendSocketMessage('progress', message);
                            }
                        });
                        igPublisherProcess.on('error', (err) => {
                            const message = 'Error executing FHIR IG Publisher: ' + err;
                            this.log.error(message);
                            this.sendSocketMessage('error', message);
                        });
                        igPublisherProcess.on('exit', (code) => {
                            this.log.debug(`IG Publisher is done executing for ${rootPath}`);
                            this.sendSocketMessage('progress', 'IG Publisher finished with code ' + code);
                            if (code !== 0) {
                                this.sendSocketMessage('progress', 'Won\'t copy output to deployment path.');
                                this.sendSocketMessage('complete', 'Done. You will be prompted to download the package in a moment.');
                            }
                            else {
                                this.sendSocketMessage('progress', 'Copying output to deployment path.');
                                const generatedPath = path.resolve(rootPath, 'generated_output');
                                const outputPath = path.resolve(rootPath, 'output');
                                this.log.debug(`Deleting content generated by ig publisher in ${generatedPath}`);
                                fs.emptyDir(generatedPath, (err) => {
                                    if (err) {
                                        this.log.error(err);
                                    }
                                });
                                this.log.debug(`Copying output from ${outputPath} to ${deployDir}`);
                                fs.copy(outputPath, deployDir, (err) => {
                                    if (err) {
                                        this.log.error(err);
                                        this.sendSocketMessage('error', 'Error copying contents to deployment path.');
                                    }
                                    else {
                                        const finalMessage = `Done executing the FHIR IG Publisher. You may view the IG <a href="/implementation-guide/${this.implementationGuideId}/view">here</a>.` + (downloadOutput ? ' You will be prompted to download the package in a moment.' : '');
                                        this.sendSocketMessage('complete', finalMessage);
                                    }
                                    if (!downloadOutput) {
                                        this.log.debug(`User indicated they don't need to download. Removing temporary directory ${rootPath}`);
                                        fs.emptyDir(rootPath, (err) => {
                                            if (err) {
                                                this.log.error(err);
                                            }
                                            else {
                                                this.log.debug(`Done removing temporary directory ${rootPath}`);
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    })
                        .catch((err) => {
                        this.log.error(err);
                        this.sendSocketMessage('error', 'Error during export: ' + err);
                        if (testCallback) {
                            testCallback(rootPath, err);
                        }
                    });
                }, 1000);
            });
        });
    }
}
exports.HtmlExporter = HtmlExporter;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHRtbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImh0bWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQSxpREFBb0M7QUFlcEMsaUNBQWlDO0FBQ2pDLDZCQUE2QjtBQUM3QixnQ0FBZ0M7QUFDaEMsc0NBQXNDO0FBQ3RDLCtCQUErQjtBQUMvQixpQ0FBaUM7QUFDakMsMkJBQTJCO0FBQzNCLHlDQUF5QztBQVN6QyxxQ0FBd0M7QUFFeEMsbURBQThDO0FBRTlDLE1BQU0sVUFBVSxHQUFnQixNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ25ELE1BQU0sWUFBWSxHQUFrQixNQUFNLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBUXpELE1BQWEsWUFBWTtJQVlyQixZQUFZLGNBQXNCLEVBQUUsWUFBb0IsRUFBRSxXQUFtQixFQUFFLElBQWdCLEVBQUUsRUFBVSxFQUFFLFFBQWdCLEVBQUUscUJBQTZCO1FBWG5KLFFBQUcsR0FBRyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7UUFZOUIsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUM7UUFDckMsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUM7UUFDakMsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUM7UUFDL0IsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUM7UUFDYixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUN6QixJQUFJLENBQUMscUJBQXFCLEdBQUcscUJBQXFCLENBQUM7SUFDdkQsQ0FBQztJQUVPLGNBQWMsQ0FBQyxJQUFzQjtRQUN6QyxJQUFJLENBQUMsSUFBSSxFQUFFO1lBQ1AsT0FBTztTQUNWO1FBRUQsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUU7WUFDMUIsT0FBZ0IsSUFBSSxDQUFDO1NBQ3hCO1FBRUQsSUFBSSxPQUFPLEdBQUcs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QUMsR0FBRyxDQUFDLENBQUM7d0JBQ3BCLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLEVBQUUsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLENBQUM7d0JBRS9ELElBQUksWUFBWSxFQUFFOzRCQUNkLFlBQVksQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7eUJBQy9CO29CQUNMLENBQUMsQ0FBQyxDQUFDO2dCQUNYLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNiLENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUF2N0JELG9DQXU3QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge0ZoaXIgYXMgRmhpck1vZHVsZX0gZnJvbSAnZmhpci9maGlyJztcclxuaW1wb3J0IHtTZXJ2ZXJ9IGZyb20gJ3NvY2tldC5pbyc7XHJcbmltcG9ydCB7c3Bhd259IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xyXG5pbXBvcnQge1xyXG4gICAgRG9tYWluUmVzb3VyY2UsXHJcbiAgICBIdW1hbk5hbWUsXHJcbiAgICBCdW5kbGUgYXMgU1RVM0J1bmRsZSxcclxuICAgIEJpbmFyeSBhcyBTVFUzQmluYXJ5LFxyXG4gICAgSW1wbGVtZW50YXRpb25HdWlkZSBhcyBTVFUzSW1wbGVtZW50YXRpb25HdWlkZSxcclxuICAgIFBhZ2VDb21wb25lbnQsIEV4dGVuc2lvblxyXG59IGZyb20gJy4uLy4uL3NyYy9hcHAvbW9kZWxzL3N0dTMvZmhpcic7XHJcbmltcG9ydCB7XHJcbiAgICBCaW5hcnkgYXMgUjRCaW5hcnksXHJcbiAgICBCdW5kbGUgYXMgUjRCdW5kbGUsXHJcbiAgICBJbXBsZW1lbnRhdGlvbkd1aWRlIGFzIFI0SW1wbGVtZW50YXRpb25HdWlkZSxcclxuICAgIEltcGxlbWVudGF0aW9uR3VpZGVQYWdlQ29tcG9uZW50XHJcbn0gZnJvbSAnLi4vLi4vc3JjL2FwcC9tb2RlbHMvcjQvZmhpcic7XHJcbmltcG9ydCAqIGFzIGxvZzRqcyBmcm9tICdsb2c0anMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyBfIGZyb20gJ3VuZGVyc2NvcmUnO1xyXG5pbXBvcnQgKiBhcyBycCBmcm9tICdyZXF1ZXN0LXByb21pc2UnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XHJcbmltcG9ydCAqIGFzIGNvbmZpZyBmcm9tICdjb25maWcnO1xyXG5pbXBvcnQgKiBhcyB0bXAgZnJvbSAndG1wJztcclxuaW1wb3J0ICogYXMgdmtiZWF1dGlmeSBmcm9tICd2a2JlYXV0aWZ5JztcclxuaW1wb3J0IHtcclxuICAgIEZoaXIsXHJcbiAgICBGaGlyQ29uZmlnLFxyXG4gICAgRmhpckNvbmZpZ1NlcnZlcixcclxuICAgIEZoaXJDb250cm9sLFxyXG4gICAgRmhpckNvbnRyb2xEZXBlbmRlbmN5LFxyXG4gICAgU2VydmVyQ29uZmlnXHJcbn0gZnJvbSAnLi4vY29udHJvbGxlcnMvbW9kZWxzJztcclxuaW1wb3J0IHtCdW5kbGVFeHBvcnRlcn0gZnJvbSAnLi9idW5kbGUnO1xyXG5pbXBvcnQgQnVuZGxlID0gRmhpci5CdW5kbGU7XHJcbmltcG9ydCB7R2xvYmFsc30gZnJvbSAnLi4vLi4vc3JjL2FwcC9nbG9iYWxzJztcclxuXHJcbmNvbnN0IGZoaXJDb25maWcgPSA8RmhpckNvbmZpZz4gY29uZmlnLmdldCgnZmhpcicpO1xyXG5jb25zdCBzZXJ2ZXJDb25maWcgPSA8U2VydmVyQ29uZmlnPiBjb25maWcuZ2V0KCdzZXJ2ZXInKTtcclxuXHJcbmludGVyZmFjZSBUYWJsZU9mQ29udGVudHNFbnRyeSB7XHJcbiAgICBsZXZlbDogbnVtYmVyO1xyXG4gICAgZmlsZU5hbWU6IHN0cmluZztcclxuICAgIHRpdGxlOiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBIdG1sRXhwb3J0ZXIge1xyXG4gICAgcmVhZG9ubHkgbG9nID0gbG9nNGpzLmdldExvZ2dlcigpO1xyXG4gICAgcmVhZG9ubHkgZmhpclNlcnZlckJhc2U6IHN0cmluZztcclxuICAgIHJlYWRvbmx5IGZoaXJTZXJ2ZXJJZDogc3RyaW5nO1xyXG4gICAgcmVhZG9ubHkgZmhpclZlcnNpb246IHN0cmluZztcclxuICAgIHJlYWRvbmx5IGZoaXI6IEZoaXJNb2R1bGU7XHJcbiAgICByZWFkb25seSBpbzogU2VydmVyO1xyXG4gICAgcmVhZG9ubHkgc29ja2V0SWQ6IHN0cmluZztcclxuICAgIHJlYWRvbmx5IGltcGxlbWVudGF0aW9uR3VpZGVJZDogc3RyaW5nO1xyXG5cclxuICAgIHByaXZhdGUgcGFja2FnZUlkOiBzdHJpbmc7XHJcblxyXG4gICAgY29uc3RydWN0b3IoZmhpclNlcnZlckJhc2U6IHN0cmluZywgZmhpclNlcnZlcklkOiBzdHJpbmcsIGZoaXJWZXJzaW9uOiBzdHJpbmcsIGZoaXI6IEZoaXJNb2R1bGUsIGlvOiBTZXJ2ZXIsIHNvY2tldElkOiBzdHJpbmcsIGltcGxlbWVudGF0aW9uR3VpZGVJZDogc3RyaW5nKSB7XHJcbiAgICAgICAgdGhpcy5maGlyU2VydmVyQmFzZSA9IGZoaXJTZXJ2ZXJCYXNlO1xyXG4gICAgICAgIHRoaXMuZmhpclNlcnZlcklkID0gZmhpclNlcnZlcklkO1xyXG4gICAgICAgIHRoaXMuZmhpclZlcnNpb24gPSBmaGlyVmVyc2lvbjtcclxuICAgICAgICB0aGlzLmZoaXIgPSBmaGlyO1xyXG4gICAgICAgIHRoaXMuaW8gPSBpbztcclxuICAgICAgICB0aGlzLnNvY2tldElkID0gc29ja2V0SWQ7XHJcbiAgICAgICAgdGhpcy5pbXBsZW1lbnRhdGlvbkd1aWRlSWQgPSBpbXBsZW1lbnRhdGlvbkd1aWRlSWQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBnZXREaXNwbGF5TmFtZShuYW1lOiBzdHJpbmd8SHVtYW5OYW1lKTogc3RyaW5nIHtcclxuICAgICAgICBpZiAoIW5hbWUpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHR5cGVvZiBuYW1lID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZXR1cm4gPHN0cmluZz4gbmFtZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGxldCBkaXNwbGF5ID0gbmFtZS5mYW1pbHk7XHJcblxyXG4gICAgICAgIGlmIChuYW1lLmdpdmVuKSB7XHJcbiAgICAgICAgICAgIGlmIChkaXNwbGF5KSB7XHJcbiAgICAgICAgICAgICAgICBkaXNwbGF5ICs9ICcsICc7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBkaXNwbGF5ID0gJyc7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGRpc3BsYXkgKz0gbmFtZS5naXZlbi5qb2luKCcgJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZGlzcGxheTtcclxuICAgIH1cclxuXHJcblxyXG4gICAgcHJpdmF0ZSBjcmVhdGVUYWJsZUZyb21BcnJheShoZWFkZXJzLCBkYXRhKSB7XHJcbiAgICAgICAgbGV0IG91dHB1dCA9ICc8dGFibGU+XFxuPHRoZWFkPlxcbjx0cj5cXG4nO1xyXG5cclxuICAgICAgICBfLmVhY2goaGVhZGVycywgKGhlYWRlcikgPT4ge1xyXG4gICAgICAgICAgICBvdXRwdXQgKz0gYDx0aD4ke2hlYWRlcn08L3RoPlxcbmA7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIG91dHB1dCArPSAnPC90cj5cXG48L3RoZWFkPlxcbjx0Ym9keT5cXG4nO1xyXG5cclxuICAgICAgICBfLmVhY2goZGF0YSwgKHJvdzogc3RyaW5nW10pID0+IHtcclxuICAgICAgICAgICAgb3V0cHV0ICs9ICc8dHI+XFxuJztcclxuXHJcbiAgICAgICAgICAgIF8uZWFjaChyb3csIChjZWxsKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBvdXRwdXQgKz0gYDx0ZD4ke2NlbGx9PC90ZD5cXG5gO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIG91dHB1dCArPSAnPC90cj5cXG4nO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBvdXRwdXQgKz0gJzwvdGJvZHk+XFxuPC90YWJsZT5cXG4nO1xyXG5cclxuICAgICAgICByZXR1cm4gb3V0cHV0O1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgc2VuZFNvY2tldE1lc3NhZ2Uoc3RhdHVzLCBtZXNzYWdlKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnNvY2tldElkKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdXb25cXCd0IHNlbmQgc29ja2V0IG1lc3NhZ2UgZm9yIGV4cG9ydCBiZWNhdXNlIHRoZSBvcmlnaW5hbCByZXF1ZXN0IGRpZCBub3Qgc3BlY2lmeSBhIHNvY2tldElkJyk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICh0aGlzLmlvKSB7XHJcbiAgICAgICAgICAgIHRoaXMuaW8udG8odGhpcy5zb2NrZXRJZCkuZW1pdCgnaHRtbC1leHBvcnQnLCB7XHJcbiAgICAgICAgICAgICAgICBwYWNrYWdlSWQ6IHRoaXMucGFja2FnZUlkLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiBzdGF0dXMsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGdldElnUHVibGlzaGVyKHVzZUxhdGVzdDogYm9vbGVhbik6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gJ29yZy5obDcuZmhpci5pZ3B1Ymxpc2hlci5qYXInO1xyXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0UGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9pZy1wdWJsaXNoZXInKTtcclxuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbGVQYXRoID0gcGF0aC5qb2luKGRlZmF1bHRQYXRoLCBmaWxlTmFtZSk7XHJcblxyXG4gICAgICAgICAgICBpZiAodXNlTGF0ZXN0ID09PSB0cnVlKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnUmVxdWVzdCB0byBnZXQgbGF0ZXN0IHZlcnNpb24gb2YgRkhJUiBJRyBwdWJsaXNoZXIuIFJldHJpZXZpbmcgZnJvbTogJyArIGZoaXJDb25maWcubGF0ZXN0UHVibGlzaGVyKTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsICdEb3dubG9hZGluZyBsYXRlc3QgRkhJUiBJRyBwdWJsaXNoZXInKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBUT0RPOiBDaGVjayBodHRwOi8vYnVpbGQuZmhpci5vcmcvdmVyc2lvbi5pbmZvIGZpcnN0XHJcblxyXG4gICAgICAgICAgICAgICAgcnAoZmhpckNvbmZpZy5sYXRlc3RQdWJsaXNoZXIsIHsgZW5jb2Rpbmc6IG51bGwgfSlcclxuICAgICAgICAgICAgICAgICAgICAudGhlbigocmVzdWx0cykgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnU3VjY2Vzc2Z1bGx5IGRvd25sb2FkZWQgbGF0ZXN0IHZlcnNpb24gb2YgRkhJUiBJRyBQdWJsaXNoZXIuIEVuc3VyaW5nIGxhdGVzdCBkaXJlY3RvcnkgZXhpc3RzJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXRlc3RQYXRoID0gcGF0aC5qb2luKGRlZmF1bHRQYXRoLCAnbGF0ZXN0Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZzLmVuc3VyZURpclN5bmMobGF0ZXN0UGF0aCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBub2luc3BlY3Rpb24gSlNVbnJlc29sdmVkRnVuY3Rpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYnVmZiA9IEJ1ZmZlci5mcm9tKHJlc3VsdHMsICd1dGY4Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhdGVzdEZpbGVQYXRoID0gcGF0aC5qb2luKGxhdGVzdFBhdGgsIGZpbGVOYW1lKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdTYXZpbmcgRkhJUiBJRyBwdWJsaXNoZXIgdG8gJyArIGxhdGVzdEZpbGVQYXRoKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMobGF0ZXN0RmlsZVBhdGgsIGJ1ZmYpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShsYXRlc3RGaWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihgRXJyb3IgZ2V0dGluZyBsYXRlc3QgdmVyc2lvbiBvZiBGSElSIElHIHB1Ymxpc2hlcjogJHtlcnJ9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0VuY291bnRlcmVkIGVycm9yIGRvd25sb2FkaW5nIGxhdGVzdCBJRyBwdWJsaXNoZXIsIHdpbGwgdXNlIHByZS1sb2FkZWQvZGVmYXVsdCBJRyBwdWJsaXNoZXInKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShkZWZhdWx0RmlsZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ1VzaW5nIGJ1aWx0LWluIHZlcnNpb24gb2YgRkhJUiBJRyBwdWJsaXNoZXIgZm9yIGV4cG9ydCcpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCAnVXNpbmcgZXhpc3RpbmcvZGVmYXVsdCB2ZXJzaW9uIG9mIEZISVIgSUcgcHVibGlzaGVyJyk7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKGRlZmF1bHRGaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpdmF0ZSBjb3B5RXh0ZW5zaW9uKGRlc3RFeHRlbnNpb25zRGlyOiBzdHJpbmcsIGV4dGVuc2lvbkZpbGVOYW1lOiBzdHJpbmcsIGlzWG1sOiBib29sZWFuLCBmaGlyOiBGaGlyTW9kdWxlKSB7XHJcbiAgICAgICAgY29uc3Qgc291cmNlRXh0ZW5zaW9uc0RpciA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9zcmMvYXNzZXRzL3N0dTMvZXh0ZW5zaW9ucycpO1xyXG4gICAgICAgIGNvbnN0IHNvdXJjZUV4dGVuc2lvbkZpbGVOYW1lID0gcGF0aC5qb2luKHNvdXJjZUV4dGVuc2lvbnNEaXIsIGV4dGVuc2lvbkZpbGVOYW1lKTtcclxuICAgICAgICBsZXQgZGVzdEV4dGVuc2lvbkZpbGVOYW1lID0gcGF0aC5qb2luKGRlc3RFeHRlbnNpb25zRGlyLCBleHRlbnNpb25GaWxlTmFtZSk7XHJcblxyXG4gICAgICAgIGlmICghaXNYbWwpIHtcclxuICAgICAgICAgICAgZnMuY29weVN5bmMoc291cmNlRXh0ZW5zaW9uRmlsZU5hbWUsIGRlc3RFeHRlbnNpb25GaWxlTmFtZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3QgZXh0ZW5zaW9uSnNvbiA9IGZzLnJlYWRGaWxlU3luYyhzb3VyY2VFeHRlbnNpb25GaWxlTmFtZSkudG9TdHJpbmcoKTtcclxuICAgICAgICAgICAgY29uc3QgZXh0ZW5zaW9uWG1sID0gZmhpci5qc29uVG9YbWwoZXh0ZW5zaW9uSnNvbik7XHJcblxyXG4gICAgICAgICAgICBkZXN0RXh0ZW5zaW9uRmlsZU5hbWUgPSBkZXN0RXh0ZW5zaW9uRmlsZU5hbWUuc3Vic3RyaW5nKDAsIGRlc3RFeHRlbnNpb25GaWxlTmFtZS5pbmRleE9mKCcuanNvbicpKSArICcueG1sJztcclxuICAgICAgICAgICAgZnMud3JpdGVGaWxlU3luYyhkZXN0RXh0ZW5zaW9uRmlsZU5hbWUsIGV4dGVuc2lvblhtbCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIGdldERlcGVuZGVuY2llcyhjb250cm9sLCBpc1htbDogYm9vbGVhbiwgcmVzb3VyY2VzRGlyOiBzdHJpbmcsIGZoaXI6IEZoaXJNb2R1bGUsIGZoaXJTZXJ2ZXJDb25maWc6IEZoaXJDb25maWdTZXJ2ZXIpOiBQcm9taXNlPGFueT4ge1xyXG4gICAgICAgIGNvbnN0IGlzU3R1MyA9IGZoaXJTZXJ2ZXJDb25maWcgJiYgZmhpclNlcnZlckNvbmZpZy52ZXJzaW9uID09PSAnc3R1Myc7XHJcblxyXG4gICAgICAgIC8vIExvYWQgdGhlIGlnIGRlcGVuZGVuY3kgZXh0ZW5zaW9ucyBpbnRvIHRoZSByZXNvdXJjZXMgZGlyZWN0b3J5XHJcbiAgICAgICAgaWYgKGlzU3R1MyAmJiBjb250cm9sLmRlcGVuZGVuY3lMaXN0ICYmIGNvbnRyb2wuZGVwZW5kZW5jeUxpc3QubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBjb25zdCBkZXN0RXh0ZW5zaW9uc0RpciA9IHBhdGguam9pbihyZXNvdXJjZXNEaXIsICdzdHJ1Y3R1cmVkZWZpbml0aW9uJyk7XHJcblxyXG4gICAgICAgICAgICBmcy5lbnN1cmVEaXJTeW5jKGRlc3RFeHRlbnNpb25zRGlyKTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuY29weUV4dGVuc2lvbihkZXN0RXh0ZW5zaW9uc0RpciwgJ2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5Lmpzb24nLCBpc1htbCwgZmhpcik7XHJcbiAgICAgICAgICAgIHRoaXMuY29weUV4dGVuc2lvbihkZXN0RXh0ZW5zaW9uc0RpciwgJ2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5LXZlcnNpb24uanNvbicsIGlzWG1sLCBmaGlyKTtcclxuICAgICAgICAgICAgdGhpcy5jb3B5RXh0ZW5zaW9uKGRlc3RFeHRlbnNpb25zRGlyLCAnZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktbG9jYXRpb24uanNvbicsIGlzWG1sLCBmaGlyKTtcclxuICAgICAgICAgICAgdGhpcy5jb3B5RXh0ZW5zaW9uKGRlc3RFeHRlbnNpb25zRGlyLCAnZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktbmFtZS5qc29uJywgaXNYbWwsIGZoaXIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShbXSk7ICAgICAgICAgICAvLyBUaGlzIGlzbid0IGFjdHVhbGx5IG5lZWRlZCwgc2luY2UgdGhlIElHIFB1Ymxpc2hlciBhdHRlbXB0cyB0byByZXNvbHZlIHRoZXNlIGRlcGVuZGVuY3kgYXV0b21hdGljYWxseVxyXG5cclxuICAgICAgICAvKlxyXG4gICAgICAgIC8vIEF0dGVtcHQgdG8gcmVzb2x2ZSB0aGUgZGVwZW5kZW5jeSdzIGRlZmluaXRpb25zIGFuZCBpbmNsdWRlIGl0IGluIHRoZSBwYWNrYWdlXHJcbiAgICAgICAgY29uc3QgZGVmZXJyZWQgPSBRLmRlZmVyKCk7XHJcbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBfLm1hcChjb250cm9sLmRlcGVuZGVuY3lMaXN0LCAoZGVwZW5kZW5jeSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkZXBlbmRlbmN5VXJsID1cclxuICAgICAgICAgICAgICAgIGRlcGVuZGVuY3kubG9jYXRpb24gK1xyXG4gICAgICAgICAgICAgICAgKGRlcGVuZGVuY3kubG9jYXRpb24uZW5kc1dpdGgoJy8nKSA/ICcnIDogJy8nKSArICdkZWZpbml0aW9ucy4nICtcclxuICAgICAgICAgICAgICAgIChpc1htbCA/ICd4bWwnIDogJ2pzb24nKSArXHJcbiAgICAgICAgICAgICAgICAnLnppcCc7XHJcbiAgICAgICAgICAgIHJldHVybiBnZXREZXBlbmRlbmN5KGRlcGVuZGVuY3lVcmwsIGRlcGVuZGVuY3kubmFtZSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICBcclxuICAgICAgICBRLmFsbChwcm9taXNlcylcclxuICAgICAgICAgICAgLnRoZW4oZGVmZXJyZWQucmVzb2x2ZSlcclxuICAgICAgICAgICAgLmNhdGNoKGRlZmVycmVkLnJlamVjdCk7XHJcbiAgICBcclxuICAgICAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcclxuICAgICAgICAqL1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIGdldEZoaXJDb250cm9sVmVyc2lvbihmaGlyU2VydmVyQ29uZmlnKSB7XHJcbiAgICAgICAgY29uc3QgY29uZmlnVmVyc2lvbiA9IGZoaXJTZXJ2ZXJDb25maWcgPyBmaGlyU2VydmVyQ29uZmlnLnZlcnNpb24gOiBudWxsO1xyXG5cclxuICAgICAgICAvLyBUT0RPOiBBZGQgbW9yZSBsb2dpY1xyXG4gICAgICAgIHN3aXRjaCAoY29uZmlnVmVyc2lvbikge1xyXG4gICAgICAgICAgICBjYXNlICdzdHUzJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiAnMy4wLjEnO1xyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuICc0LjAuMCc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIHVwZGF0ZVRlbXBsYXRlcyhyb290UGF0aCwgYnVuZGxlLCBpbXBsZW1lbnRhdGlvbkd1aWRlOiBTVFUzSW1wbGVtZW50YXRpb25HdWlkZSkge1xyXG4gICAgICAgIGNvbnN0IG1haW5SZXNvdXJjZVR5cGVzID0gWydJbXBsZW1lbnRhdGlvbkd1aWRlJywgJ1ZhbHVlU2V0JywgJ0NvZGVTeXN0ZW0nLCAnU3RydWN0dXJlRGVmaW5pdGlvbicsICdDYXBhYmlsaXR5U3RhdGVtZW50J107XHJcbiAgICAgICAgY29uc3QgZGlzdGluY3RSZXNvdXJjZXMgPSBfLmNoYWluKGJ1bmRsZS5lbnRyeSlcclxuICAgICAgICAgICAgLm1hcCgoZW50cnkpID0+IGVudHJ5LnJlc291cmNlKVxyXG4gICAgICAgICAgICAudW5pcSgocmVzb3VyY2UpID0+IHJlc291cmNlLmlkKVxyXG4gICAgICAgICAgICAudmFsdWUoKTtcclxuICAgICAgICBjb25zdCB2YWx1ZVNldHMgPSBfLmZpbHRlcihkaXN0aW5jdFJlc291cmNlcywgKHJlc291cmNlKSA9PiByZXNvdXJjZS5yZXNvdXJjZVR5cGUgPT09ICdWYWx1ZVNldCcpO1xyXG4gICAgICAgIGNvbnN0IGNvZGVTeXN0ZW1zID0gXy5maWx0ZXIoZGlzdGluY3RSZXNvdXJjZXMsIChyZXNvdXJjZSkgPT4gcmVzb3VyY2UucmVzb3VyY2VUeXBlID09PSAnQ29kZVN5c3RlbScpO1xyXG4gICAgICAgIGNvbnN0IHByb2ZpbGVzID0gXy5maWx0ZXIoZGlzdGluY3RSZXNvdXJjZXMsIChyZXNvdXJjZSkgPT4gcmVzb3VyY2UucmVzb3VyY2VUeXBlID09PSAnU3RydWN0dXJlRGVmaW5pdGlvbicgJiYgKCFyZXNvdXJjZS5iYXNlRGVmaW5pdGlvbiB8fCAhcmVzb3VyY2UuYmFzZURlZmluaXRpb24uZW5kc1dpdGgoJ0V4dGVuc2lvbicpKSk7XHJcbiAgICAgICAgY29uc3QgZXh0ZW5zaW9ucyA9IF8uZmlsdGVyKGRpc3RpbmN0UmVzb3VyY2VzLCAocmVzb3VyY2UpID0+IHJlc291cmNlLnJlc291cmNlVHlwZSA9PT0gJ1N0cnVjdHVyZURlZmluaXRpb24nICYmIHJlc291cmNlLmJhc2VEZWZpbml0aW9uICYmIHJlc291cmNlLmJhc2VEZWZpbml0aW9uLmVuZHNXaXRoKCdFeHRlbnNpb24nKSk7XHJcbiAgICAgICAgY29uc3QgY2FwYWJpbGl0eVN0YXRlbWVudHMgPSBfLmZpbHRlcihkaXN0aW5jdFJlc291cmNlcywgKHJlc291cmNlKSA9PiByZXNvdXJjZS5yZXNvdXJjZVR5cGUgPT09ICdDYXBhYmlsaXR5U3RhdGVtZW50Jyk7XHJcbiAgICAgICAgY29uc3Qgb3RoZXJSZXNvdXJjZXMgPSBfLmZpbHRlcihkaXN0aW5jdFJlc291cmNlcywgKHJlc291cmNlKSA9PiBtYWluUmVzb3VyY2VUeXBlcy5pbmRleE9mKHJlc291cmNlLnJlc291cmNlVHlwZSkgPCAwKTtcclxuXHJcbiAgICAgICAgaWYgKGltcGxlbWVudGF0aW9uR3VpZGUpIHtcclxuICAgICAgICAgICAgY29uc3QgaW5kZXhQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL2luZGV4Lm1kJyk7XHJcblxyXG4gICAgICAgICAgICBpZiAoaW1wbGVtZW50YXRpb25HdWlkZS5kZXNjcmlwdGlvbikge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVzY3JpcHRpb25Db250ZW50ID0gJyMjIyBEZXNjcmlwdGlvblxcblxcbicgKyBpbXBsZW1lbnRhdGlvbkd1aWRlLmRlc2NyaXB0aW9uICsgJ1xcblxcbic7XHJcbiAgICAgICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhpbmRleFBhdGgsIGRlc2NyaXB0aW9uQ29udGVudCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChpbXBsZW1lbnRhdGlvbkd1aWRlLmNvbnRhY3QpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGF1dGhvcnNEYXRhID0gXy5tYXAoaW1wbGVtZW50YXRpb25HdWlkZS5jb250YWN0LCAoY29udGFjdCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvdW5kRW1haWwgPSBfLmZpbmQoY29udGFjdC50ZWxlY29tLCAodGVsZWNvbSkgPT4gdGVsZWNvbS5zeXN0ZW0gPT09ICdlbWFpbCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbY29udGFjdC5uYW1lLCBmb3VuZEVtYWlsID8gYDxhIGhyZWY9XCJtYWlsdG86JHtmb3VuZEVtYWlsLnZhbHVlfVwiPiR7Zm91bmRFbWFpbC52YWx1ZX08L2E+YCA6ICcnXTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXV0aG9yc0NvbnRlbnQgPSAnIyMjIEF1dGhvcnNcXG5cXG4nICsgdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ05hbWUnLCAnRW1haWwnXSwgYXV0aG9yc0RhdGEpICsgJ1xcblxcbic7XHJcbiAgICAgICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhpbmRleFBhdGgsIGF1dGhvcnNDb250ZW50KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHByb2ZpbGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgY29uc3QgcHJvZmlsZXNEYXRhID0gXy5jaGFpbihwcm9maWxlcylcclxuICAgICAgICAgICAgICAgIC5zb3J0QnkoKHByb2ZpbGUpID0+IHByb2ZpbGUubmFtZSlcclxuICAgICAgICAgICAgICAgIC5tYXAoKHByb2ZpbGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW2A8YSBocmVmPVwiU3RydWN0dXJlRGVmaW5pdGlvbi0ke3Byb2ZpbGUuaWR9Lmh0bWxcIj4ke3Byb2ZpbGUubmFtZX08L2E+YCwgcHJvZmlsZS5kZXNjcmlwdGlvbiB8fCAnJ107XHJcbiAgICAgICAgICAgICAgICB9KS52YWx1ZSgpO1xyXG4gICAgICAgICAgICBjb25zdCBwcm9maWxlc1RhYmxlID0gdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ05hbWUnLCAnRGVzY3JpcHRpb24nXSwgcHJvZmlsZXNEYXRhKTtcclxuICAgICAgICAgICAgY29uc3QgcHJvZmlsZXNQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL3Byb2ZpbGVzLm1kJyk7XHJcbiAgICAgICAgICAgIGZzLmFwcGVuZEZpbGVTeW5jKHByb2ZpbGVzUGF0aCwgJyMjIyBQcm9maWxlc1xcblxcbicgKyBwcm9maWxlc1RhYmxlICsgJ1xcblxcbicpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGV4dGVuc2lvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBjb25zdCBleHREYXRhID0gXy5jaGFpbihleHRlbnNpb25zKVxyXG4gICAgICAgICAgICAgICAgLnNvcnRCeSgoZXh0ZW5zaW9uKSA9PiBleHRlbnNpb24ubmFtZSlcclxuICAgICAgICAgICAgICAgIC5tYXAoKGV4dGVuc2lvbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbYDxhIGhyZWY9XCJTdHJ1Y3R1cmVEZWZpbml0aW9uLSR7ZXh0ZW5zaW9uLmlkfS5odG1sXCI+JHtleHRlbnNpb24ubmFtZX08L2E+YCwgZXh0ZW5zaW9uLmRlc2NyaXB0aW9uIHx8ICcnXTtcclxuICAgICAgICAgICAgICAgIH0pLnZhbHVlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGV4dENvbnRlbnQgPSB0aGlzLmNyZWF0ZVRhYmxlRnJvbUFycmF5KFsnTmFtZScsICdEZXNjcmlwdGlvbiddLCBleHREYXRhKTtcclxuICAgICAgICAgICAgY29uc3QgZXh0UGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ3NvdXJjZS9wYWdlcy9wcm9maWxlcy5tZCcpO1xyXG4gICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhleHRQYXRoLCAnIyMjIEV4dGVuc2lvbnNcXG5cXG4nICsgZXh0Q29udGVudCArICdcXG5cXG4nKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICh2YWx1ZVNldHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBsZXQgdnNDb250ZW50ID0gJyMjIyBWYWx1ZSBTZXRzXFxuXFxuJztcclxuICAgICAgICAgICAgY29uc3QgdnNQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL3Rlcm1pbm9sb2d5Lm1kJyk7XHJcblxyXG4gICAgICAgICAgICBfLmNoYWluKHZhbHVlU2V0cylcclxuICAgICAgICAgICAgICAgIC5zb3J0QnkoKHZhbHVlU2V0KSA9PiB2YWx1ZVNldC50aXRsZSB8fCB2YWx1ZVNldC5uYW1lKVxyXG4gICAgICAgICAgICAgICAgLmVhY2goKHZhbHVlU2V0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdnNDb250ZW50ICs9IGAtIFske3ZhbHVlU2V0LnRpdGxlIHx8IHZhbHVlU2V0Lm5hbWV9XShWYWx1ZVNldC0ke3ZhbHVlU2V0LmlkfS5odG1sKVxcbmA7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGZzLmFwcGVuZEZpbGVTeW5jKHZzUGF0aCwgdnNDb250ZW50ICsgJ1xcblxcbicpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGNvZGVTeXN0ZW1zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgbGV0IGNzQ29udGVudCA9ICcjIyMgQ29kZSBTeXN0ZW1zXFxuXFxuJztcclxuICAgICAgICAgICAgY29uc3QgY3NQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL3Rlcm1pbm9sb2d5Lm1kJyk7XHJcblxyXG4gICAgICAgICAgICBfLmNoYWluKGNvZGVTeXN0ZW1zKVxyXG4gICAgICAgICAgICAgICAgLnNvcnRCeSgoY29kZVN5c3RlbSkgPT4gY29kZVN5c3RlbS50aXRsZSB8fCBjb2RlU3lzdGVtLm5hbWUpXHJcbiAgICAgICAgICAgICAgICAuZWFjaCgoY29kZVN5c3RlbSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNzQ29udGVudCArPSBgLSBbJHtjb2RlU3lzdGVtLnRpdGxlIHx8IGNvZGVTeXN0ZW0ubmFtZX1dKFZhbHVlU2V0LSR7Y29kZVN5c3RlbS5pZH0uaHRtbClcXG5gO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhjc1BhdGgsIGNzQ29udGVudCArICdcXG5cXG4nKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChjYXBhYmlsaXR5U3RhdGVtZW50cy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNzRGF0YSA9IF8uY2hhaW4oY2FwYWJpbGl0eVN0YXRlbWVudHMpXHJcbiAgICAgICAgICAgICAgICAuc29ydEJ5KChjYXBhYmlsaXR5U3RhdGVtZW50KSA9PiBjYXBhYmlsaXR5U3RhdGVtZW50Lm5hbWUpXHJcbiAgICAgICAgICAgICAgICAubWFwKChjYXBhYmlsaXR5U3RhdGVtZW50KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtgPGEgaHJlZj1cIkNhcGFiaWxpdHlTdGF0ZW1lbnQtJHtjYXBhYmlsaXR5U3RhdGVtZW50LmlkfS5odG1sXCI+JHtjYXBhYmlsaXR5U3RhdGVtZW50Lm5hbWV9PC9hPmAsIGNhcGFiaWxpdHlTdGF0ZW1lbnQuZGVzY3JpcHRpb24gfHwgJyddO1xyXG4gICAgICAgICAgICAgICAgfSkudmFsdWUoKTtcclxuICAgICAgICAgICAgY29uc3QgY3NDb250ZW50ID0gdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ05hbWUnLCAnRGVzY3JpcHRpb24nXSwgY3NEYXRhKTtcclxuICAgICAgICAgICAgY29uc3QgY3NQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzL2NhcHN0YXRlbWVudHMubWQnKTtcclxuICAgICAgICAgICAgZnMuYXBwZW5kRmlsZVN5bmMoY3NQYXRoLCAnIyMjIENhcGFiaWxpdHlTdGF0ZW1lbnRzXFxuXFxuJyArIGNzQ29udGVudCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAob3RoZXJSZXNvdXJjZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBjb25zdCBvRGF0YSA9IF8uY2hhaW4ob3RoZXJSZXNvdXJjZXMpXHJcbiAgICAgICAgICAgICAgICAuc29ydEJ5KChyZXNvdXJjZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGxldCBkaXNwbGF5ID0gcmVzb3VyY2UudGl0bGUgfHwgdGhpcy5nZXREaXNwbGF5TmFtZShyZXNvdXJjZS5uYW1lKSB8fCByZXNvdXJjZS5pZDtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzb3VyY2UucmVzb3VyY2VUeXBlICsgZGlzcGxheTtcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICAubWFwKChyZXNvdXJjZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGxldCBuYW1lID0gcmVzb3VyY2UudGl0bGUgfHwgdGhpcy5nZXREaXNwbGF5TmFtZShyZXNvdXJjZS5uYW1lKSB8fCByZXNvdXJjZS5pZDtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW3Jlc291cmNlLnJlc291cmNlVHlwZSwgYDxhIGhyZWY9XCIke3Jlc291cmNlLnJlc291cmNlVHlwZX0tJHtyZXNvdXJjZS5pZH0uaHRtbFwiPiR7bmFtZX08L2E+YF07XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgLnZhbHVlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG9Db250ZW50ID0gdGhpcy5jcmVhdGVUYWJsZUZyb21BcnJheShbJ1R5cGUnLCAnTmFtZSddLCBvRGF0YSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNzUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ3NvdXJjZS9wYWdlcy9vdGhlci5tZCcpO1xyXG4gICAgICAgICAgICBmcy5hcHBlbmRGaWxlU3luYyhjc1BhdGgsICcjIyMgT3RoZXIgUmVzb3VyY2VzXFxuXFxuJyArIG9Db250ZW50KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHByaXZhdGUgd3JpdGVGaWxlc0ZvclJlc291cmNlcyhyb290UGF0aDogc3RyaW5nLCByZXNvdXJjZTogRG9tYWluUmVzb3VyY2UpIHtcclxuICAgICAgICBpZiAoIXJlc291cmNlIHx8ICFyZXNvdXJjZS5yZXNvdXJjZVR5cGUgfHwgcmVzb3VyY2UucmVzb3VyY2VUeXBlID09PSAnSW1wbGVtZW50YXRpb25HdWlkZScpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaW50cm9QYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCBgc291cmNlL3BhZ2VzL19pbmNsdWRlcy8ke3Jlc291cmNlLmlkfS1pbnRyby5tZGApO1xyXG4gICAgICAgIGNvbnN0IHNlYXJjaFBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsIGBzb3VyY2UvcGFnZXMvX2luY2x1ZGVzLyR7cmVzb3VyY2UuaWR9LXNlYXJjaC5tZGApO1xyXG4gICAgICAgIGNvbnN0IHN1bW1hcnlQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCBgc291cmNlL3BhZ2VzL19pbmNsdWRlcy8ke3Jlc291cmNlLmlkfS1zdW1tYXJ5Lm1kYCk7XHJcblxyXG4gICAgICAgIGxldCBpbnRybyA9ICctLS1cXG4nICtcclxuICAgICAgICAgICAgYHRpdGxlOiAke3Jlc291cmNlLnJlc291cmNlVHlwZX0tJHtyZXNvdXJjZS5pZH0taW50cm9cXG5gICtcclxuICAgICAgICAgICAgJ2xheW91dDogZGVmYXVsdFxcbicgK1xyXG4gICAgICAgICAgICBgYWN0aXZlOiAke3Jlc291cmNlLnJlc291cmNlVHlwZX0tJHtyZXNvdXJjZS5pZH0taW50cm9cXG5gICtcclxuICAgICAgICAgICAgJy0tLVxcblxcbic7XHJcblxyXG4gICAgICAgIGlmICgoPGFueT5yZXNvdXJjZSkuZGVzY3JpcHRpb24pIHtcclxuICAgICAgICAgICAgaW50cm8gKz0gKDxhbnk+cmVzb3VyY2UpLmRlc2NyaXB0aW9uO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhpbnRyb1BhdGgsIGludHJvKTtcclxuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHNlYXJjaFBhdGgsICdUT0RPIC0gU2VhcmNoJyk7XHJcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhzdW1tYXJ5UGF0aCwgJ1RPRE8gLSBTdW1tYXJ5Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHByaXZhdGUgZ2V0U3R1M0NvbnRyb2woaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUsIGJ1bmRsZTogU1RVM0J1bmRsZSwgdmVyc2lvbikge1xyXG4gICAgICAgIGNvbnN0IGNhbm9uaWNhbEJhc2VSZWdleCA9IC9eKC4rPylcXC9JbXBsZW1lbnRhdGlvbkd1aWRlXFwvLiskL2dtO1xyXG4gICAgICAgIGNvbnN0IGNhbm9uaWNhbEJhc2VNYXRjaCA9IGNhbm9uaWNhbEJhc2VSZWdleC5leGVjKGltcGxlbWVudGF0aW9uR3VpZGUudXJsKTtcclxuICAgICAgICBjb25zdCBwYWNrYWdlSWRFeHRlbnNpb24gPSBfLmZpbmQoaW1wbGVtZW50YXRpb25HdWlkZS5leHRlbnNpb24sIChleHRlbnNpb24pID0+IGV4dGVuc2lvbi51cmwgPT09IEdsb2JhbHMuZXh0ZW5zaW9uVXJsc1snZXh0ZW5zaW9uLWlnLXBhY2thZ2UtaWQnXSk7XHJcbiAgICAgICAgbGV0IGNhbm9uaWNhbEJhc2U7XHJcblxyXG4gICAgICAgIGlmICghY2Fub25pY2FsQmFzZU1hdGNoIHx8IGNhbm9uaWNhbEJhc2VNYXRjaC5sZW5ndGggPCAyKSB7XHJcbiAgICAgICAgICAgIGNhbm9uaWNhbEJhc2UgPSBpbXBsZW1lbnRhdGlvbkd1aWRlLnVybC5zdWJzdHJpbmcoMCwgaW1wbGVtZW50YXRpb25HdWlkZS51cmwubGFzdEluZGV4T2YoJy8nKSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY2Fub25pY2FsQmFzZSA9IGNhbm9uaWNhbEJhc2VNYXRjaFsxXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFRPRE86IEV4dHJhY3QgbnBtLW5hbWUgZnJvbSBJRyBleHRlbnNpb24uXHJcbiAgICAgICAgLy8gY3VycmVudGx5LCBJRyByZXNvdXJjZSBoYXMgdG8gYmUgaW4gWE1MIGZvcm1hdCBmb3IgdGhlIElHIFB1Ymxpc2hlclxyXG4gICAgICAgIGNvbnN0IGNvbnRyb2wgPSA8RmhpckNvbnRyb2w+IHtcclxuICAgICAgICAgICAgdG9vbDogJ2pla3lsbCcsXHJcbiAgICAgICAgICAgIHNvdXJjZTogJ2ltcGxlbWVudGF0aW9uZ3VpZGUvJyArIGltcGxlbWVudGF0aW9uR3VpZGUuaWQgKyAnLnhtbCcsXHJcbiAgICAgICAgICAgICducG0tbmFtZSc6IHBhY2thZ2VJZEV4dGVuc2lvbiAmJiBwYWNrYWdlSWRFeHRlbnNpb24udmFsdWVTdHJpbmcgPyBwYWNrYWdlSWRFeHRlbnNpb24udmFsdWVTdHJpbmcgOiBpbXBsZW1lbnRhdGlvbkd1aWRlLmlkICsgJy1ucG0nLFxyXG4gICAgICAgICAgICBsaWNlbnNlOiAnQ0MwLTEuMCcsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUjQ6IEltcGxlbWVudGF0aW9uR3VpZGUubGljZW5zZVxyXG4gICAgICAgICAgICBwYXRoczoge1xyXG4gICAgICAgICAgICAgICAgcWE6ICdnZW5lcmF0ZWRfb3V0cHV0L3FhJyxcclxuICAgICAgICAgICAgICAgIHRlbXA6ICdnZW5lcmF0ZWRfb3V0cHV0L3RlbXAnLFxyXG4gICAgICAgICAgICAgICAgb3V0cHV0OiAnb3V0cHV0JyxcclxuICAgICAgICAgICAgICAgIHR4Q2FjaGU6ICdnZW5lcmF0ZWRfb3V0cHV0L3R4Q2FjaGUnLFxyXG4gICAgICAgICAgICAgICAgc3BlY2lmaWNhdGlvbjogJ2h0dHA6Ly9obDcub3JnL2ZoaXIvU1RVMycsXHJcbiAgICAgICAgICAgICAgICBwYWdlczogW1xyXG4gICAgICAgICAgICAgICAgICAgICdmcmFtZXdvcmsnLFxyXG4gICAgICAgICAgICAgICAgICAgICdzb3VyY2UvcGFnZXMnXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbICdzb3VyY2UvcmVzb3VyY2VzJyBdXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHBhZ2VzOiBbJ3BhZ2VzJ10sXHJcbiAgICAgICAgICAgICdleHRlbnNpb24tZG9tYWlucyc6IFsnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20nXSxcclxuICAgICAgICAgICAgJ2FsbG93ZWQtZG9tYWlucyc6IFsnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20nXSxcclxuICAgICAgICAgICAgJ3NjdC1lZGl0aW9uJzogJ2h0dHA6Ly9zbm9tZWQuaW5mby9zY3QvNzMxMDAwMTI0MTA4JyxcclxuICAgICAgICAgICAgY2Fub25pY2FsQmFzZTogY2Fub25pY2FsQmFzZSxcclxuICAgICAgICAgICAgZGVmYXVsdHM6IHtcclxuICAgICAgICAgICAgICAgICdMb2NhdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnUHJvY2VkdXJlUmVxdWVzdCc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnT3JnYW5pemF0aW9uJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcclxuICAgICAgICAgICAgICAgICdNZWRpY2F0aW9uU3RhdGVtZW50Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcclxuICAgICAgICAgICAgICAgICdTZWFyY2hQYXJhbWV0ZXInOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnU3RydWN0dXJlRGVmaW5pdGlvbic6IHtcclxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtbWFwcGluZ3MnOiAnc2QtbWFwcGluZ3MuaHRtbCcsXHJcbiAgICAgICAgICAgICAgICAgICAgJ3RlbXBsYXRlLWJhc2UnOiAnc2QuaHRtbCcsXHJcbiAgICAgICAgICAgICAgICAgICAgJ3RlbXBsYXRlLWRlZm5zJzogJ3NkLWRlZmluaXRpb25zLmh0bWwnXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgJ0ltbXVuaXphdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnUGF0aWVudCc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnU3RydWN0dXJlTWFwJzoge1xyXG4gICAgICAgICAgICAgICAgICAgICdjb250ZW50JzogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgJ3NjcmlwdCc6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnLFxyXG4gICAgICAgICAgICAgICAgICAgICdwcm9maWxlcyc6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgJ0NvbmNlcHRNYXAnOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnUHJhY3RpdGlvbmVyJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2V4Lmh0bWwnfSxcclxuICAgICAgICAgICAgICAgICdPcGVyYXRpb25EZWZpbml0aW9uJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ0NvZGVTeXN0ZW0nOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnQ29tbXVuaWNhdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnQW55Jzoge1xyXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1mb3JtYXQnOiAnZm9ybWF0Lmh0bWwnLFxyXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCdcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAnUHJhY3RpdGlvbmVyUm9sZSc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnVmFsdWVTZXQnOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnQ2FwYWJpbGl0eVN0YXRlbWVudCc6IHsndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnfSxcclxuICAgICAgICAgICAgICAgICdPYnNlcnZhdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ31cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgcmVzb3VyY2VzOiB7fVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGlmICh2ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIGNvbnRyb2wudmVyc2lvbiA9IHZlcnNpb247XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTZXQgdGhlIGRlcGVuZGVuY3lMaXN0IGJhc2VkIG9uIHRoZSBleHRlbnNpb25zIGluIHRoZSBJR1xyXG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY3lFeHRlbnNpb25zID0gXy5maWx0ZXIoaW1wbGVtZW50YXRpb25HdWlkZS5leHRlbnNpb24sIChleHRlbnNpb24pID0+IGV4dGVuc2lvbi51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbS9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5Jyk7XHJcblxyXG4gICAgICAgIC8vIFI0IEltcGxlbWVudGF0aW9uR3VpZGUuZGVwZW5kc09uXHJcbiAgICAgICAgY29udHJvbC5kZXBlbmRlbmN5TGlzdCA9IF8uY2hhaW4oZGVwZW5kZW5jeUV4dGVuc2lvbnMpXHJcbiAgICAgICAgICAgIC5maWx0ZXIoKGRlcGVuZGVuY3lFeHRlbnNpb24pID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY2F0aW9uRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZGVuY3lFeHRlbnNpb24uZXh0ZW5zaW9uLCAobmV4dCkgPT4gbmV4dC51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbS9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5LWxvY2F0aW9uJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZGVuY3lFeHRlbnNpb24uZXh0ZW5zaW9uLCAobmV4dCkgPT4gbmV4dC51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbS9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5LW5hbWUnKTtcclxuXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gISFsb2NhdGlvbkV4dGVuc2lvbiAmJiAhIWxvY2F0aW9uRXh0ZW5zaW9uLnZhbHVlU3RyaW5nICYmICEhbmFtZUV4dGVuc2lvbiAmJiAhIW5hbWVFeHRlbnNpb24udmFsdWVTdHJpbmc7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIC5tYXAoKGRlcGVuZGVuY3lFeHRlbnNpb24pID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxvY2F0aW9uRXh0ZW5zaW9uID0gPEV4dGVuc2lvbj4gXy5maW5kKGRlcGVuZGVuY3lFeHRlbnNpb24uZXh0ZW5zaW9uLCAobmV4dCkgPT4gbmV4dC51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbS9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5LWxvY2F0aW9uJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lRXh0ZW5zaW9uID0gPEV4dGVuc2lvbj4gXy5maW5kKGRlcGVuZGVuY3lFeHRlbnNpb24uZXh0ZW5zaW9uLCAobmV4dCkgPT4gbmV4dC51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLW9uLWZoaXIubGFudGFuYWdyb3VwLmNvbS9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRlbmN5LW5hbWUnKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZlcnNpb25FeHRlbnNpb24gPSA8RXh0ZW5zaW9uPiBfLmZpbmQoZGVwZW5kZW5jeUV4dGVuc2lvbi5leHRlbnNpb24sIChuZXh0KSA9PiBuZXh0LnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tL1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZGVuY3ktdmVyc2lvbicpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybiA8RmhpckNvbnRyb2xEZXBlbmRlbmN5PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbG9jYXRpb246IGxvY2F0aW9uRXh0ZW5zaW9uID8gbG9jYXRpb25FeHRlbnNpb24udmFsdWVVcmkgOiAnJyxcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lRXh0ZW5zaW9uID8gbmFtZUV4dGVuc2lvbi52YWx1ZVN0cmluZyA6ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIHZlcnNpb246IHZlcnNpb25FeHRlbnNpb24gPyB2ZXJzaW9uRXh0ZW5zaW9uLnZhbHVlU3RyaW5nIDogJydcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIC52YWx1ZSgpO1xyXG5cclxuICAgICAgICAvLyBEZWZpbmUgdGhlIHJlc291cmNlcyBpbiB0aGUgY29udHJvbCBhbmQgd2hhdCB0ZW1wbGF0ZXMgdGhleSBzaG91bGQgdXNlXHJcbiAgICAgICAgaWYgKGJ1bmRsZSAmJiBidW5kbGUuZW50cnkpIHtcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBidW5kbGUuZW50cnkubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVudHJ5ID0gYnVuZGxlLmVudHJ5W2ldO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2UgPSBlbnRyeS5yZXNvdXJjZTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAocmVzb3VyY2UucmVzb3VyY2VUeXBlID09PSAnSW1wbGVtZW50YXRpb25HdWlkZScpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBjb250cm9sLnJlc291cmNlc1tyZXNvdXJjZS5yZXNvdXJjZVR5cGUgKyAnLycgKyByZXNvdXJjZS5pZF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYmFzZTogcmVzb3VyY2UucmVzb3VyY2VUeXBlICsgJy0nICsgcmVzb3VyY2UuaWQgKyAnLmh0bWwnLFxyXG4gICAgICAgICAgICAgICAgICAgIGRlZm5zOiByZXNvdXJjZS5yZXNvdXJjZVR5cGUgKyAnLScgKyByZXNvdXJjZS5pZCArICctZGVmaW5pdGlvbnMuaHRtbCdcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBjb250cm9sO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIGdldFI0Q29udHJvbChpbXBsZW1lbnRhdGlvbkd1aWRlOiBSNEltcGxlbWVudGF0aW9uR3VpZGUsIGJ1bmRsZTogUjRCdW5kbGUsIHZlcnNpb246IHN0cmluZykge1xyXG4gICAgICAgIGNvbnN0IGNhbm9uaWNhbEJhc2VSZWdleCA9IC9eKC4rPylcXC9JbXBsZW1lbnRhdGlvbkd1aWRlXFwvLiskL2dtO1xyXG4gICAgICAgIGNvbnN0IGNhbm9uaWNhbEJhc2VNYXRjaCA9IGNhbm9uaWNhbEJhc2VSZWdleC5leGVjKGltcGxlbWVudGF0aW9uR3VpZGUudXJsKTtcclxuICAgICAgICBsZXQgY2Fub25pY2FsQmFzZTtcclxuXHJcbiAgICAgICAgaWYgKCFjYW5vbmljYWxCYXNlTWF0Y2ggfHwgY2Fub25pY2FsQmFzZU1hdGNoLmxlbmd0aCA8IDIpIHtcclxuICAgICAgICAgICAgY2Fub25pY2FsQmFzZSA9IGltcGxlbWVudGF0aW9uR3VpZGUudXJsLnN1YnN0cmluZygwLCBpbXBsZW1lbnRhdGlvbkd1aWRlLnVybC5sYXN0SW5kZXhPZignLycpKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjYW5vbmljYWxCYXNlID0gY2Fub25pY2FsQmFzZU1hdGNoWzFdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gY3VycmVudGx5LCBJRyByZXNvdXJjZSBoYXMgdG8gYmUgaW4gWE1MIGZvcm1hdCBmb3IgdGhlIElHIFB1Ymxpc2hlclxyXG4gICAgICAgIGNvbnN0IGNvbnRyb2wgPSA8RmhpckNvbnRyb2w+IHtcclxuICAgICAgICAgICAgdG9vbDogJ2pla3lsbCcsXHJcbiAgICAgICAgICAgIHNvdXJjZTogJ2ltcGxlbWVudGF0aW9uZ3VpZGUvJyArIGltcGxlbWVudGF0aW9uR3VpZGUuaWQgKyAnLnhtbCcsXHJcbiAgICAgICAgICAgICducG0tbmFtZSc6IGltcGxlbWVudGF0aW9uR3VpZGUucGFja2FnZUlkIHx8IGltcGxlbWVudGF0aW9uR3VpZGUuaWQgKyAnLW5wbScsXHJcbiAgICAgICAgICAgIGxpY2Vuc2U6IGltcGxlbWVudGF0aW9uR3VpZGUubGljZW5zZSB8fCAnQ0MwLTEuMCcsXHJcbiAgICAgICAgICAgIHBhdGhzOiB7XHJcbiAgICAgICAgICAgICAgICBxYTogJ2dlbmVyYXRlZF9vdXRwdXQvcWEnLFxyXG4gICAgICAgICAgICAgICAgdGVtcDogJ2dlbmVyYXRlZF9vdXRwdXQvdGVtcCcsXHJcbiAgICAgICAgICAgICAgICBvdXRwdXQ6ICdvdXRwdXQnLFxyXG4gICAgICAgICAgICAgICAgdHhDYWNoZTogJ2dlbmVyYXRlZF9vdXRwdXQvdHhDYWNoZScsXHJcbiAgICAgICAgICAgICAgICBzcGVjaWZpY2F0aW9uOiAnaHR0cDovL2hsNy5vcmcvZmhpci9SNC8nLFxyXG4gICAgICAgICAgICAgICAgcGFnZXM6IFtcclxuICAgICAgICAgICAgICAgICAgICAnZnJhbWV3b3JrJyxcclxuICAgICAgICAgICAgICAgICAgICAnc291cmNlL3BhZ2VzJ1xyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWyAnc291cmNlL3Jlc291cmNlcycgXVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBwYWdlczogWydwYWdlcyddLFxyXG4gICAgICAgICAgICAnZXh0ZW5zaW9uLWRvbWFpbnMnOiBbJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tJ10sXHJcbiAgICAgICAgICAgICdhbGxvd2VkLWRvbWFpbnMnOiBbJ2h0dHBzOi8vdHJpZm9saWEtb24tZmhpci5sYW50YW5hZ3JvdXAuY29tJ10sXHJcbiAgICAgICAgICAgICdzY3QtZWRpdGlvbic6ICdodHRwOi8vc25vbWVkLmluZm8vc2N0LzczMTAwMDEyNDEwOCcsXHJcbiAgICAgICAgICAgIGNhbm9uaWNhbEJhc2U6IGNhbm9uaWNhbEJhc2UsXHJcbiAgICAgICAgICAgIGRlZmF1bHRzOiB7XHJcbiAgICAgICAgICAgICAgICAnTG9jYXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ1Byb2NlZHVyZVJlcXVlc3QnOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ09yZ2FuaXphdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnTWVkaWNhdGlvblN0YXRlbWVudCc6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnU2VhcmNoUGFyYW1ldGVyJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ1N0cnVjdHVyZURlZmluaXRpb24nOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgJ3RlbXBsYXRlLW1hcHBpbmdzJzogJ3NkLW1hcHBpbmdzLmh0bWwnLFxyXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1iYXNlJzogJ3NkLmh0bWwnLFxyXG4gICAgICAgICAgICAgICAgICAgICd0ZW1wbGF0ZS1kZWZucyc6ICdzZC1kZWZpbml0aW9ucy5odG1sJ1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICdJbW11bml6YXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ1BhdGllbnQnOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ1N0cnVjdHVyZU1hcCc6IHtcclxuICAgICAgICAgICAgICAgICAgICAnY29udGVudCc6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICdzY3JpcHQnOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJyxcclxuICAgICAgICAgICAgICAgICAgICAncHJvZmlsZXMnOiBmYWxzZVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICdDb25jZXB0TWFwJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ1ByYWN0aXRpb25lcic6IHsndGVtcGxhdGUtYmFzZSc6ICdleC5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnT3BlcmF0aW9uRGVmaW5pdGlvbic6IHsndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnfSxcclxuICAgICAgICAgICAgICAgICdDb2RlU3lzdGVtJzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ0NvbW11bmljYXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ0FueSc6IHtcclxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtZm9ybWF0JzogJ2Zvcm1hdC5odG1sJyxcclxuICAgICAgICAgICAgICAgICAgICAndGVtcGxhdGUtYmFzZSc6ICdiYXNlLmh0bWwnXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgJ1ByYWN0aXRpb25lclJvbGUnOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ1ZhbHVlU2V0Jzogeyd0ZW1wbGF0ZS1iYXNlJzogJ2Jhc2UuaHRtbCd9LFxyXG4gICAgICAgICAgICAgICAgJ0NhcGFiaWxpdHlTdGF0ZW1lbnQnOiB7J3RlbXBsYXRlLWJhc2UnOiAnYmFzZS5odG1sJ30sXHJcbiAgICAgICAgICAgICAgICAnT2JzZXJ2YXRpb24nOiB7J3RlbXBsYXRlLWJhc2UnOiAnZXguaHRtbCd9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHJlc291cmNlczoge31cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBpZiAodmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb250cm9sLnZlcnNpb24gPSB2ZXJzaW9uO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGltcGxlbWVudGF0aW9uR3VpZGUuZmhpclZlcnNpb24gJiYgaW1wbGVtZW50YXRpb25HdWlkZS5maGlyVmVyc2lvbi5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIGNvbnRyb2xbJ2ZpeGVkLWJ1c2luZXNzLXZlcnNpb24nXSA9IGltcGxlbWVudGF0aW9uR3VpZGUuZmhpclZlcnNpb25bMF07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb250cm9sLmRlcGVuZGVuY3lMaXN0ID0gXy5jaGFpbihpbXBsZW1lbnRhdGlvbkd1aWRlLmRlcGVuZHNPbilcclxuICAgICAgICAgICAgLmZpbHRlcigoZGVwZW5kc09uKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb2NhdGlvbkV4dGVuc2lvbiA9IF8uZmluZChkZXBlbmRzT24uZXh0ZW5zaW9uLCAoZGVwZW5kZW5jeUV4dGVuc2lvbikgPT4gZGVwZW5kZW5jeUV4dGVuc2lvbi51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLWZoaXIubGFudGFuYWdyb3VwLmNvbS9yNC9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRzLW9uLWxvY2F0aW9uJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZHNPbi5leHRlbnNpb24sIChkZXBlbmRlbmN5RXh0ZW5zaW9uKSA9PiBkZXBlbmRlbmN5RXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtZmhpci5sYW50YW5hZ3JvdXAuY29tL3I0L1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZHMtb24tbmFtZScpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybiAhIWxvY2F0aW9uRXh0ZW5zaW9uICYmICEhbG9jYXRpb25FeHRlbnNpb24udmFsdWVTdHJpbmcgJiYgISFuYW1lRXh0ZW5zaW9uICYmICEhbmFtZUV4dGVuc2lvbi52YWx1ZVN0cmluZztcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgLm1hcCgoZGVwZW5kc09uKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsb2NhdGlvbkV4dGVuc2lvbiA9IF8uZmluZChkZXBlbmRzT24uZXh0ZW5zaW9uLCAoZGVwZW5kZW5jeUV4dGVuc2lvbikgPT4gZGVwZW5kZW5jeUV4dGVuc2lvbi51cmwgPT09ICdodHRwczovL3RyaWZvbGlhLWZoaXIubGFudGFuYWdyb3VwLmNvbS9yNC9TdHJ1Y3R1cmVEZWZpbml0aW9uL2V4dGVuc2lvbi1pZy1kZXBlbmRzLW9uLWxvY2F0aW9uJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lRXh0ZW5zaW9uID0gXy5maW5kKGRlcGVuZHNPbi5leHRlbnNpb24sIChkZXBlbmRlbmN5RXh0ZW5zaW9uKSA9PiBkZXBlbmRlbmN5RXh0ZW5zaW9uLnVybCA9PT0gJ2h0dHBzOi8vdHJpZm9saWEtZmhpci5sYW50YW5hZ3JvdXAuY29tL3I0L1N0cnVjdHVyZURlZmluaXRpb24vZXh0ZW5zaW9uLWlnLWRlcGVuZHMtb24tbmFtZScpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbG9jYXRpb246IGxvY2F0aW9uRXh0ZW5zaW9uID8gbG9jYXRpb25FeHRlbnNpb24udmFsdWVTdHJpbmcgOiAnJyxcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lRXh0ZW5zaW9uID8gbmFtZUV4dGVuc2lvbi52YWx1ZVN0cmluZyA6ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIHZlcnNpb246IGRlcGVuZHNPbi52ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAudmFsdWUoKTtcclxuXHJcbiAgICAgICAgLy8gRGVmaW5lIHRoZSByZXNvdXJjZXMgaW4gdGhlIGNvbnRyb2wgYW5kIHdoYXQgdGVtcGxhdGVzIHRoZXkgc2hvdWxkIHVzZVxyXG4gICAgICAgIGlmIChidW5kbGUgJiYgYnVuZGxlLmVudHJ5KSB7XHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYnVuZGxlLmVudHJ5Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRyeSA9IGJ1bmRsZS5lbnRyeVtpXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc291cmNlID0gZW50cnkucmVzb3VyY2U7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKHJlc291cmNlLnJlc291cmNlVHlwZSA9PT0gJ0ltcGxlbWVudGF0aW9uR3VpZGUnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgY29udHJvbC5yZXNvdXJjZXNbcmVzb3VyY2UucmVzb3VyY2VUeXBlICsgJy8nICsgcmVzb3VyY2UuaWRdID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIGJhc2U6IHJlc291cmNlLnJlc291cmNlVHlwZSArICctJyArIHJlc291cmNlLmlkICsgJy5odG1sJyxcclxuICAgICAgICAgICAgICAgICAgICBkZWZuczogcmVzb3VyY2UucmVzb3VyY2VUeXBlICsgJy0nICsgcmVzb3VyY2UuaWQgKyAnLWRlZmluaXRpb25zLmh0bWwnXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gY29udHJvbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpdmF0ZSBnZXRTdHUzUGFnZUNvbnRlbnQoaW1wbGVtZW50YXRpb25HdWlkZTogU1RVM0ltcGxlbWVudGF0aW9uR3VpZGUsIHBhZ2U6IFBhZ2VDb21wb25lbnQpIHtcclxuICAgICAgICBjb25zdCBjb250ZW50RXh0ZW5zaW9uID0gXy5maW5kKHBhZ2UuZXh0ZW5zaW9uLCAoZXh0ZW5zaW9uKSA9PiBleHRlbnNpb24udXJsID09PSAnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20vU3RydWN0dXJlRGVmaW5pdGlvbi9leHRlbnNpb24taWctcGFnZS1jb250ZW50Jyk7XHJcblxyXG4gICAgICAgIGlmIChjb250ZW50RXh0ZW5zaW9uICYmIGNvbnRlbnRFeHRlbnNpb24udmFsdWVSZWZlcmVuY2UgJiYgY29udGVudEV4dGVuc2lvbi52YWx1ZVJlZmVyZW5jZS5yZWZlcmVuY2UgJiYgcGFnZS5zb3VyY2UpIHtcclxuICAgICAgICAgICAgY29uc3QgcmVmZXJlbmNlID0gY29udGVudEV4dGVuc2lvbi52YWx1ZVJlZmVyZW5jZS5yZWZlcmVuY2U7XHJcblxyXG4gICAgICAgICAgICBpZiAocmVmZXJlbmNlLnN0YXJ0c1dpdGgoJyMnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVkID0gXy5maW5kKGltcGxlbWVudGF0aW9uR3VpZGUuY29udGFpbmVkLCAoY29udGFpbmVkKSA9PiBjb250YWluZWQuaWQgPT09IHJlZmVyZW5jZS5zdWJzdHJpbmcoMSkpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYmluYXJ5ID0gY29udGFpbmVkICYmIGNvbnRhaW5lZC5yZXNvdXJjZVR5cGUgPT09ICdCaW5hcnknID8gPFNUVTNCaW5hcnk+IGNvbnRhaW5lZCA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoYmluYXJ5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IHBhZ2Uuc291cmNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBCdWZmZXIuZnJvbShiaW5hcnkuY29udGVudCwgJ2Jhc2U2NCcpLnRvU3RyaW5nKClcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIHdyaXRlU3R1M1BhZ2UocGFnZXNQYXRoOiBzdHJpbmcsIGltcGxlbWVudGF0aW9uR3VpZGU6IFNUVTNJbXBsZW1lbnRhdGlvbkd1aWRlLCBwYWdlOiBQYWdlQ29tcG9uZW50LCBsZXZlbDogbnVtYmVyLCB0b2NFbnRyaWVzOiBUYWJsZU9mQ29udGVudHNFbnRyeVtdKSB7XHJcbiAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSB0aGlzLmdldFN0dTNQYWdlQ29udGVudChpbXBsZW1lbnRhdGlvbkd1aWRlLCBwYWdlKTtcclxuXHJcbiAgICAgICAgaWYgKHBhZ2Uua2luZCAhPT0gJ3RvYycgJiYgcGFnZUNvbnRlbnQgJiYgcGFnZUNvbnRlbnQuY29udGVudCkge1xyXG4gICAgICAgICAgICBjb25zdCBuZXdQYWdlUGF0aCA9IHBhdGguam9pbihwYWdlc1BhdGgsIHBhZ2VDb250ZW50LmZpbGVOYW1lKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSAnLS0tXFxuJyArXHJcbiAgICAgICAgICAgICAgICBgdGl0bGU6ICR7cGFnZS50aXRsZX1cXG5gICtcclxuICAgICAgICAgICAgICAgICdsYXlvdXQ6IGRlZmF1bHRcXG4nICtcclxuICAgICAgICAgICAgICAgIGBhY3RpdmU6ICR7cGFnZS50aXRsZX1cXG5gICtcclxuICAgICAgICAgICAgICAgICctLS1cXG5cXG4nICsgcGFnZUNvbnRlbnQuY29udGVudDtcclxuXHJcbiAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMobmV3UGFnZVBhdGgsIGNvbnRlbnQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQWRkIGFuIGVudHJ5IHRvIHRoZSBUT0NcclxuICAgICAgICB0b2NFbnRyaWVzLnB1c2goeyBsZXZlbDogbGV2ZWwsIGZpbGVOYW1lOiBwYWdlLmtpbmQgPT09ICdwYWdlJyAmJiBwYWdlQ29udGVudCA/IHBhZ2VDb250ZW50LmZpbGVOYW1lIDogbnVsbCwgdGl0bGU6IHBhZ2UudGl0bGUgfSk7XHJcbiAgICAgICAgXy5lYWNoKHBhZ2UucGFnZSwgKHN1YlBhZ2UpID0+IHRoaXMud3JpdGVTdHUzUGFnZShwYWdlc1BhdGgsIGltcGxlbWVudGF0aW9uR3VpZGUsIHN1YlBhZ2UsIGxldmVsICsgMSwgdG9jRW50cmllcykpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIGdldFBhZ2VFeHRlbnNpb24ocGFnZTogSW1wbGVtZW50YXRpb25HdWlkZVBhZ2VDb21wb25lbnQpIHtcclxuICAgICAgICBzd2l0Y2ggKHBhZ2UuZ2VuZXJhdGlvbikge1xyXG4gICAgICAgICAgICBjYXNlICdodG1sJzpcclxuICAgICAgICAgICAgY2FzZSAnZ2VuZXJhdGVkJzpcclxuICAgICAgICAgICAgICAgIHJldHVybiAnLmh0bWwnO1xyXG4gICAgICAgICAgICBjYXNlICd4bWwnOlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuICcueG1sJztcclxuICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgIHJldHVybiAnLm1kJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHByaXZhdGUgd3JpdGVSNFBhZ2UocGFnZXNQYXRoOiBzdHJpbmcsIGltcGxlbWVudGF0aW9uR3VpZGU6IFI0SW1wbGVtZW50YXRpb25HdWlkZSwgcGFnZTogSW1wbGVtZW50YXRpb25HdWlkZVBhZ2VDb21wb25lbnQsIGxldmVsOiBudW1iZXIsIHRvY0VudHJpZXM6IFRhYmxlT2ZDb250ZW50c0VudHJ5W10pIHtcclxuICAgICAgICBsZXQgZmlsZU5hbWU7XHJcblxyXG4gICAgICAgIGlmIChwYWdlLm5hbWVSZWZlcmVuY2UgJiYgcGFnZS5uYW1lUmVmZXJlbmNlLnJlZmVyZW5jZSAmJiBwYWdlLnRpdGxlKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlZmVyZW5jZSA9IHBhZ2UubmFtZVJlZmVyZW5jZS5yZWZlcmVuY2U7XHJcblxyXG4gICAgICAgICAgICBpZiAocmVmZXJlbmNlLnN0YXJ0c1dpdGgoJyMnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY29udGFpbmVkID0gXy5maW5kKGltcGxlbWVudGF0aW9uR3VpZGUuY29udGFpbmVkLCAoY29udGFpbmVkKSA9PiBjb250YWluZWQuaWQgPT09IHJlZmVyZW5jZS5zdWJzdHJpbmcoMSkpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYmluYXJ5ID0gY29udGFpbmVkICYmIGNvbnRhaW5lZC5yZXNvdXJjZVR5cGUgPT09ICdCaW5hcnknID8gPFI0QmluYXJ5PiBjb250YWluZWQgOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGJpbmFyeSAmJiBiaW5hcnkuZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lID0gcGFnZS50aXRsZS5yZXBsYWNlKC8gL2csICdfJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChmaWxlTmFtZS5pbmRleE9mKCcuJykgPCAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lICs9IHRoaXMuZ2V0UGFnZUV4dGVuc2lvbihwYWdlKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld1BhZ2VQYXRoID0gcGF0aC5qb2luKHBhZ2VzUGF0aCwgZmlsZU5hbWUpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBub2luc3BlY3Rpb24gSlNVbnJlc29sdmVkRnVuY3Rpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBiaW5hcnlDb250ZW50ID0gQnVmZmVyLmZyb20oYmluYXJ5LmRhdGEsICdiYXNlNjQnKS50b1N0cmluZygpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSAnLS0tXFxuJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGB0aXRsZTogJHtwYWdlLnRpdGxlfVxcbmAgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAnbGF5b3V0OiBkZWZhdWx0XFxuJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGBhY3RpdmU6ICR7cGFnZS50aXRsZX1cXG5gICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYC0tLVxcblxcbiR7YmluYXJ5Q29udGVudH1gO1xyXG4gICAgICAgICAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMobmV3UGFnZVBhdGgsIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBBZGQgYW4gZW50cnkgdG8gdGhlIFRPQ1xyXG4gICAgICAgIHRvY0VudHJpZXMucHVzaCh7IGxldmVsOiBsZXZlbCwgZmlsZU5hbWU6IGZpbGVOYW1lLCB0aXRsZTogcGFnZS50aXRsZSB9KTtcclxuXHJcbiAgICAgICAgXy5lYWNoKHBhZ2UucGFnZSwgKHN1YlBhZ2UpID0+IHRoaXMud3JpdGVSNFBhZ2UocGFnZXNQYXRoLCBpbXBsZW1lbnRhdGlvbkd1aWRlLCBzdWJQYWdlLCBsZXZlbCArIDEsIHRvY0VudHJpZXMpKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpdmF0ZSBnZW5lcmF0ZVRhYmxlT2ZDb250ZW50cyhyb290UGF0aDogc3RyaW5nLCB0b2NFbnRyaWVzOiBUYWJsZU9mQ29udGVudHNFbnRyeVtdLCBzaG91bGRBdXRvR2VuZXJhdGU6IGJvb2xlYW4sIHBhZ2VDb250ZW50KSB7XHJcbiAgICAgICAgY29uc3QgdG9jUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ3NvdXJjZS9wYWdlcy90b2MubWQnKTtcclxuICAgICAgICBsZXQgdG9jQ29udGVudCA9ICcnO1xyXG5cclxuICAgICAgICBpZiAoc2hvdWxkQXV0b0dlbmVyYXRlKSB7XHJcbiAgICAgICAgICAgIF8uZWFjaCh0b2NFbnRyaWVzLCAoZW50cnkpID0+IHtcclxuICAgICAgICAgICAgICAgIGxldCBmaWxlTmFtZSA9IGVudHJ5LmZpbGVOYW1lO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChmaWxlTmFtZSAmJiBmaWxlTmFtZS5lbmRzV2l0aCgnLm1kJykpIHtcclxuICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZSA9IGZpbGVOYW1lLnN1YnN0cmluZygwLCBmaWxlTmFtZS5sZW5ndGggLSAzKSArICcuaHRtbCc7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCBlbnRyeS5sZXZlbDsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG9jQ29udGVudCArPSAnICAgICc7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgdG9jQ29udGVudCArPSAnKiAnO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChmaWxlTmFtZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRvY0NvbnRlbnQgKz0gYDxhIGhyZWY9XCIke2ZpbGVOYW1lfVwiPiR7ZW50cnkudGl0bGV9PC9hPlxcbmA7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRvY0NvbnRlbnQgKz0gYCR7ZW50cnkudGl0bGV9XFxuYDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlQ29udGVudCAmJiBwYWdlQ29udGVudC5jb250ZW50KSB7XHJcbiAgICAgICAgICAgIHRvY0NvbnRlbnQgPSBwYWdlQ29udGVudC5jb250ZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHRvY0NvbnRlbnQpIHtcclxuICAgICAgICAgICAgZnMuYXBwZW5kRmlsZVN5bmModG9jUGF0aCwgdG9jQ29udGVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIHdyaXRlU3R1M1BhZ2VzKHJvb3RQYXRoOiBzdHJpbmcsIGltcGxlbWVudGF0aW9uR3VpZGU6IFNUVTNJbXBsZW1lbnRhdGlvbkd1aWRlKSB7XHJcbiAgICAgICAgY29uc3QgdG9jRmlsZVBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsICdzb3VyY2UvcGFnZXMvdG9jLm1kJyk7XHJcbiAgICAgICAgY29uc3QgdG9jRW50cmllcyA9IFtdO1xyXG5cclxuICAgICAgICBpZiAoaW1wbGVtZW50YXRpb25HdWlkZS5wYWdlKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGF1dG9HZW5lcmF0ZUV4dGVuc2lvbiA9IF8uZmluZChpbXBsZW1lbnRhdGlvbkd1aWRlLnBhZ2UuZXh0ZW5zaW9uLCAoZXh0ZW5zaW9uKSA9PiBleHRlbnNpb24udXJsID09PSAnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20vU3RydWN0dXJlRGVmaW5pdGlvbi9leHRlbnNpb24taWctcGFnZS1hdXRvLWdlbmVyYXRlLXRvYycpO1xyXG4gICAgICAgICAgICBjb25zdCBzaG91bGRBdXRvR2VuZXJhdGUgPSBhdXRvR2VuZXJhdGVFeHRlbnNpb24gJiYgYXV0b0dlbmVyYXRlRXh0ZW5zaW9uLnZhbHVlQm9vbGVhbiA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSB0aGlzLmdldFN0dTNQYWdlQ29udGVudChpbXBsZW1lbnRhdGlvbkd1aWRlLCBpbXBsZW1lbnRhdGlvbkd1aWRlLnBhZ2UpO1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlc1BhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsICdzb3VyY2UvcGFnZXMnKTtcclxuICAgICAgICAgICAgZnMuZW5zdXJlRGlyU3luYyhwYWdlc1BhdGgpO1xyXG5cclxuICAgICAgICAgICAgdGhpcy53cml0ZVN0dTNQYWdlKHBhZ2VzUGF0aCwgaW1wbGVtZW50YXRpb25HdWlkZSwgaW1wbGVtZW50YXRpb25HdWlkZS5wYWdlLCAxLCB0b2NFbnRyaWVzKTtcclxuICAgICAgICAgICAgdGhpcy5nZW5lcmF0ZVRhYmxlT2ZDb250ZW50cyhyb290UGF0aCwgdG9jRW50cmllcywgc2hvdWxkQXV0b0dlbmVyYXRlLCBwYWdlQ29udGVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcml2YXRlIHdyaXRlUjRQYWdlcyhyb290UGF0aDogc3RyaW5nLCBpbXBsZW1lbnRhdGlvbkd1aWRlOiBSNEltcGxlbWVudGF0aW9uR3VpZGUpIHtcclxuICAgICAgICBjb25zdCB0b2NFbnRyaWVzID0gW107XHJcbiAgICAgICAgbGV0IHNob3VsZEF1dG9HZW5lcmF0ZSA9IHRydWU7XHJcbiAgICAgICAgbGV0IHJvb3RQYWdlQ29udGVudDtcclxuICAgICAgICBsZXQgcm9vdFBhZ2VGaWxlTmFtZTtcclxuXHJcbiAgICAgICAgaWYgKGltcGxlbWVudGF0aW9uR3VpZGUuZGVmaW5pdGlvbiAmJiBpbXBsZW1lbnRhdGlvbkd1aWRlLmRlZmluaXRpb24ucGFnZSkge1xyXG4gICAgICAgICAgICBjb25zdCBhdXRvR2VuZXJhdGVFeHRlbnNpb24gPSBfLmZpbmQoaW1wbGVtZW50YXRpb25HdWlkZS5kZWZpbml0aW9uLnBhZ2UuZXh0ZW5zaW9uLCAoZXh0ZW5zaW9uKSA9PiBleHRlbnNpb24udXJsID09PSAnaHR0cHM6Ly90cmlmb2xpYS1vbi1maGlyLmxhbnRhbmFncm91cC5jb20vU3RydWN0dXJlRGVmaW5pdGlvbi9leHRlbnNpb24taWctcGFnZS1hdXRvLWdlbmVyYXRlLXRvYycpO1xyXG4gICAgICAgICAgICBzaG91bGRBdXRvR2VuZXJhdGUgPSBhdXRvR2VuZXJhdGVFeHRlbnNpb24gJiYgYXV0b0dlbmVyYXRlRXh0ZW5zaW9uLnZhbHVlQm9vbGVhbiA9PT0gdHJ1ZTtcclxuICAgICAgICAgICAgY29uc3QgcGFnZXNQYXRoID0gcGF0aC5qb2luKHJvb3RQYXRoLCAnc291cmNlL3BhZ2VzJyk7XHJcbiAgICAgICAgICAgIGZzLmVuc3VyZURpclN5bmMocGFnZXNQYXRoKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChpbXBsZW1lbnRhdGlvbkd1aWRlLmRlZmluaXRpb24ucGFnZS5uYW1lUmVmZXJlbmNlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuYW1lUmVmZXJlbmNlID0gaW1wbGVtZW50YXRpb25HdWlkZS5kZWZpbml0aW9uLnBhZ2UubmFtZVJlZmVyZW5jZTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAobmFtZVJlZmVyZW5jZS5yZWZlcmVuY2UgJiYgbmFtZVJlZmVyZW5jZS5yZWZlcmVuY2Uuc3RhcnRzV2l0aCgnIycpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm91bmRDb250YWluZWQgPSBfLmZpbmQoaW1wbGVtZW50YXRpb25HdWlkZS5jb250YWluZWQsIChjb250YWluZWQpID0+IGNvbnRhaW5lZC5pZCA9PT0gbmFtZVJlZmVyZW5jZS5yZWZlcmVuY2Uuc3Vic3RyaW5nKDEpKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBiaW5hcnkgPSBmb3VuZENvbnRhaW5lZCAmJiBmb3VuZENvbnRhaW5lZC5yZXNvdXJjZVR5cGUgPT09ICdCaW5hcnknID8gPFI0QmluYXJ5PiBmb3VuZENvbnRhaW5lZCA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGJpbmFyeSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByb290UGFnZUNvbnRlbnQgPSBuZXcgQnVmZmVyKGJpbmFyeS5kYXRhLCAnYmFzZTY0JykudG9TdHJpbmcoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcm9vdFBhZ2VGaWxlTmFtZSA9IGltcGxlbWVudGF0aW9uR3VpZGUuZGVmaW5pdGlvbi5wYWdlLnRpdGxlLnJlcGxhY2UoLyAvZywgJ18nKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcm9vdFBhZ2VGaWxlTmFtZS5lbmRzV2l0aCgnLm1kJykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvb3RQYWdlRmlsZU5hbWUgKz0gJy5tZCc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMud3JpdGVSNFBhZ2UocGFnZXNQYXRoLCBpbXBsZW1lbnRhdGlvbkd1aWRlLCBpbXBsZW1lbnRhdGlvbkd1aWRlLmRlZmluaXRpb24ucGFnZSwgMSwgdG9jRW50cmllcyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBBcHBlbmQgVE9DIEVudHJpZXMgdG8gdGhlIHRvYy5tZCBmaWxlIGluIHRoZSB0ZW1wbGF0ZVxyXG4gICAgICAgIHRoaXMuZ2VuZXJhdGVUYWJsZU9mQ29udGVudHMocm9vdFBhdGgsIHRvY0VudHJpZXMsIHNob3VsZEF1dG9HZW5lcmF0ZSwgeyBmaWxlTmFtZTogcm9vdFBhZ2VGaWxlTmFtZSwgY29udGVudDogcm9vdFBhZ2VDb250ZW50IH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwdWJsaWMgZXhwb3J0KGZvcm1hdDogc3RyaW5nLCBleGVjdXRlSWdQdWJsaXNoZXI6IGJvb2xlYW4sIHVzZVRlcm1pbm9sb2d5U2VydmVyOiBib29sZWFuLCB1c2VMYXRlc3Q6IGJvb2xlYW4sIGRvd25sb2FkT3V0cHV0OiBib29sZWFuLCBpbmNsdWRlSWdQdWJsaXNoZXJKYXI6IGJvb2xlYW4sIHRlc3RDYWxsYmFjaz86IChtZXNzYWdlLCBlcnI/KSA9PiB2b2lkKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgYnVuZGxlRXhwb3J0ZXIgPSBuZXcgQnVuZGxlRXhwb3J0ZXIodGhpcy5maGlyU2VydmVyQmFzZSwgdGhpcy5maGlyU2VydmVySWQsIHRoaXMuZmhpclZlcnNpb24sIHRoaXMuZmhpciwgdGhpcy5pbXBsZW1lbnRhdGlvbkd1aWRlSWQpO1xyXG4gICAgICAgICAgICBjb25zdCBpc1htbCA9IGZvcm1hdCA9PT0gJ3htbCcgfHwgZm9ybWF0ID09PSAnYXBwbGljYXRpb24veG1sJyB8fCBmb3JtYXQgPT09ICdhcHBsaWNhdGlvbi9maGlyK3htbCc7XHJcbiAgICAgICAgICAgIGNvbnN0IGV4dGVuc2lvbiA9ICghaXNYbWwgPyAnLmpzb24nIDogJy54bWwnKTtcclxuICAgICAgICAgICAgY29uc3QgaG9tZWRpciA9IHJlcXVpcmUoJ29zJykuaG9tZWRpcigpO1xyXG4gICAgICAgICAgICBjb25zdCBmaGlyU2VydmVyQ29uZmlnID0gXy5maW5kKGZoaXJDb25maWcuc2VydmVycywgKHNlcnZlcjogRmhpckNvbmZpZ1NlcnZlcikgPT4gc2VydmVyLmlkID09PSB0aGlzLmZoaXJTZXJ2ZXJJZCk7XHJcbiAgICAgICAgICAgIGxldCBjb250cm9sO1xyXG4gICAgICAgICAgICBsZXQgaW1wbGVtZW50YXRpb25HdWlkZVJlc291cmNlO1xyXG5cclxuICAgICAgICAgICAgdG1wLmRpcigodG1wRGlyRXJyLCByb290UGF0aCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRtcERpckVycikge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKHRtcERpckVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdCgnQW4gZXJyb3Igb2NjdXJyZWQgd2hpbGUgY3JlYXRpbmcgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAnICsgdG1wRGlyRXJyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sUGF0aCA9IHBhdGguam9pbihyb290UGF0aCwgJ2lnLmpzb24nKTtcclxuICAgICAgICAgICAgICAgIGxldCBidW5kbGU6IEJ1bmRsZTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLnBhY2thZ2VJZCA9IHJvb3RQYXRoLnN1YnN0cmluZyhyb290UGF0aC5sYXN0SW5kZXhPZihwYXRoLnNlcCkgKyAxKTtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUodGhpcy5wYWNrYWdlSWQpO1xyXG5cclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0NyZWF0ZWQgdGVtcCBkaXJlY3RvcnkuIFJldHJpZXZpbmcgcmVzb3VyY2VzIGZvciBpbXBsZW1lbnRhdGlvbiBndWlkZS4nKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJlcGFyZSBJRyBQdWJsaXNoZXIgcGFja2FnZVxyXG4gICAgICAgICAgICAgICAgICAgIGJ1bmRsZUV4cG9ydGVyLmdldEJ1bmRsZShmYWxzZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLnRoZW4oKHJlc3VsdHM6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnVuZGxlID0gPEJ1bmRsZT4gcmVzdWx0cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc291cmNlc0RpciA9IHBhdGguam9pbihyb290UGF0aCwgJ3NvdXJjZS9yZXNvdXJjZXMnKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsICdSZXNvdXJjZXMgcmV0cmlldmVkLiBQYWNrYWdpbmcuJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBidW5kbGUuZW50cnkubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXNvdXJjZSA9IGJ1bmRsZS5lbnRyeVtpXS5yZXNvdXJjZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGVhblJlc291cmNlID0gQnVuZGxlRXhwb3J0ZXIuY2xlYW51cFJlc291cmNlKHJlc291cmNlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSByZXNvdXJjZS5yZXNvdXJjZVR5cGU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWQgPSByZXNvdXJjZS5pZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXNvdXJjZURpciA9IHBhdGguam9pbihyZXNvdXJjZXNEaXIsIHJlc291cmNlVHlwZS50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVzb3VyY2VQYXRoO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVzb3VyY2VDb250ZW50ID0gbnVsbDtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlc291cmNlVHlwZSA9PT0gJ0ltcGxlbWVudGF0aW9uR3VpZGUnICYmIGlkID09PSB0aGlzLmltcGxlbWVudGF0aW9uR3VpZGVJZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbXBsZW1lbnRhdGlvbkd1aWRlUmVzb3VyY2UgPSByZXNvdXJjZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEltcGxlbWVudGF0aW9uR3VpZGUgbXVzdCBiZSBnZW5lcmF0ZWQgYXMgYW4geG1sIGZpbGUgZm9yIHRoZSBJRyBQdWJsaXNoZXIgaW4gU1RVMy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWlzWG1sICYmIHJlc291cmNlVHlwZSAhPT0gJ0ltcGxlbWVudGF0aW9uR3VpZGUnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlQ29udGVudCA9IEpTT04uc3RyaW5naWZ5KGNsZWFuUmVzb3VyY2UsIG51bGwsICdcXHQnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VQYXRoID0gcGF0aC5qb2luKHJlc291cmNlRGlyLCBpZCArICcuanNvbicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlQ29udGVudCA9IHRoaXMuZmhpci5vYmpUb1htbChjbGVhblJlc291cmNlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VDb250ZW50ID0gdmtiZWF1dGlmeS54bWwocmVzb3VyY2VDb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VQYXRoID0gcGF0aC5qb2luKHJlc291cmNlRGlyLCBpZCArICcueG1sJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5lbnN1cmVEaXJTeW5jKHJlc291cmNlRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHJlc291cmNlUGF0aCwgcmVzb3VyY2VDb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWltcGxlbWVudGF0aW9uR3VpZGVSZXNvdXJjZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlIGltcGxlbWVudGF0aW9uIGd1aWRlIHdhcyBub3QgZm91bmQgaW4gdGhlIGJ1bmRsZSByZXR1cm5lZCBieSB0aGUgc2VydmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZoaXJTZXJ2ZXJDb25maWcudmVyc2lvbiA9PT0gJ3N0dTMnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbCA9IHRoaXMuZ2V0U3R1M0NvbnRyb2woaW1wbGVtZW50YXRpb25HdWlkZVJlc291cmNlLCA8U1RVM0J1bmRsZT48YW55PiBidW5kbGUsIHRoaXMuZ2V0RmhpckNvbnRyb2xWZXJzaW9uKGZoaXJTZXJ2ZXJDb25maWcpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbCA9IHRoaXMuZ2V0UjRDb250cm9sKGltcGxlbWVudGF0aW9uR3VpZGVSZXNvdXJjZSwgPFI0QnVuZGxlPjxhbnk+IGJ1bmRsZSwgdGhpcy5nZXRGaGlyQ29udHJvbFZlcnNpb24oZmhpclNlcnZlckNvbmZpZykpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldERlcGVuZGVuY2llcyhjb250cm9sLCBpc1htbCwgcmVzb3VyY2VzRGlyLCB0aGlzLmZoaXIsIGZoaXJTZXJ2ZXJDb25maWcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDb3B5IHRoZSBjb250ZW50cyBvZiB0aGUgaWctcHVibGlzaGVyLXRlbXBsYXRlIGZvbGRlciB0byB0aGUgZXhwb3J0IHRlbXBvcmFyeSBmb2xkZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBsYXRlUGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi8nLCAnaWctcHVibGlzaGVyLXRlbXBsYXRlJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5jb3B5U3luYyh0ZW1wbGF0ZVBhdGgsIHJvb3RQYXRoKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXcml0ZSB0aGUgaWcuanNvbiBmaWxlIHRvIHRoZSBleHBvcnQgdGVtcG9yYXJ5IGZvbGRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udHJvbENvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShjb250cm9sLCBudWxsLCAnXFx0Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKGNvbnRyb2xQYXRoLCBjb250cm9sQ29udGVudCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV3JpdGUgdGhlIGludHJvLCBzdW1tYXJ5IGFuZCBzZWFyY2ggTUQgZmlsZXMgZm9yIGVhY2ggcmVzb3VyY2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF8uZWFjaChidW5kbGUuZW50cnksIChlbnRyeSkgPT4gdGhpcy53cml0ZUZpbGVzRm9yUmVzb3VyY2VzKHJvb3RQYXRoLCBlbnRyeS5yZXNvdXJjZSkpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlVGVtcGxhdGVzKHJvb3RQYXRoLCBidW5kbGUsIGltcGxlbWVudGF0aW9uR3VpZGVSZXNvdXJjZSk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZoaXJTZXJ2ZXJDb25maWcudmVyc2lvbiA9PT0gJ3N0dTMnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy53cml0ZVN0dTNQYWdlcyhyb290UGF0aCwgaW1wbGVtZW50YXRpb25HdWlkZVJlc291cmNlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy53cml0ZVI0UGFnZXMocm9vdFBhdGgsIGltcGxlbWVudGF0aW9uR3VpZGVSZXNvdXJjZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCAnRG9uZSBidWlsZGluZyBwYWNrYWdlJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0SWdQdWJsaXNoZXIodXNlTGF0ZXN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLnRoZW4oKGlnUHVibGlzaGVyTG9jYXRpb24pID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmNsdWRlSWdQdWJsaXNoZXJKYXIgJiYgaWdQdWJsaXNoZXJMb2NhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0NvcHlpbmcgSUcgUHVibGlzaGVyIEpBUiB0byB3b3JraW5nIGRpcmVjdG9yeS4nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBqYXJGaWxlTmFtZSA9IGlnUHVibGlzaGVyTG9jYXRpb24uc3Vic3RyaW5nKGlnUHVibGlzaGVyTG9jYXRpb24ubGFzdEluZGV4T2YocGF0aC5zZXApICsgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVzdEphclBhdGggPSBwYXRoLmpvaW4ocm9vdFBhdGgsIGphckZpbGVOYW1lKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5jb3B5U3luYyhpZ1B1Ymxpc2hlckxvY2F0aW9uLCBkZXN0SmFyUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFleGVjdXRlSWdQdWJsaXNoZXIgfHwgIWlnUHVibGlzaGVyTG9jYXRpb24pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdjb21wbGV0ZScsICdEb25lLiBZb3Ugd2lsbCBiZSBwcm9tcHRlZCB0byBkb3dubG9hZCB0aGUgcGFja2FnZSBpbiBhIG1vbWVudC4nKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRlc3RDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXN0Q2FsbGJhY2socm9vdFBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlcGxveURpciA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi93d3dyb290L2lncycsIHRoaXMuZmhpclNlcnZlcklkLCBpbXBsZW1lbnRhdGlvbkd1aWRlUmVzb3VyY2UuaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnMuZW5zdXJlRGlyU3luYyhkZXBsb3lEaXIpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlnUHVibGlzaGVyVmVyc2lvbiA9IHVzZUxhdGVzdCA/ICdsYXRlc3QnIDogJ2RlZmF1bHQnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvY2VzcyA9IHNlcnZlckNvbmZpZy5qYXZhTG9jYXRpb24gfHwgJ2phdmEnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgamFyUGFyYW1zID0gWyctamFyJywgaWdQdWJsaXNoZXJMb2NhdGlvbiwgJy1pZycsIGNvbnRyb2xQYXRoXTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXVzZVRlcm1pbm9sb2d5U2VydmVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgamFyUGFyYW1zLnB1c2goJy10eCcsICdOL0EnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsIGBSdW5uaW5nICR7aWdQdWJsaXNoZXJWZXJzaW9ufSBJRyBQdWJsaXNoZXI6ICR7amFyUGFyYW1zLmpvaW4oJyAnKX1gKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgU3Bhd25pbmcgRkhJUiBJRyBQdWJsaXNoZXIgSmF2YSBwcm9jZXNzIGF0ICR7cHJvY2Vzc30gd2l0aCBwYXJhbXMgJHtqYXJQYXJhbXN9YCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaWdQdWJsaXNoZXJQcm9jZXNzID0gc3Bhd24ocHJvY2VzcywgamFyUGFyYW1zKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZ1B1Ymxpc2hlclByb2Nlc3Muc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGEpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZGF0YS50b1N0cmluZygpLnJlcGxhY2UodG1wLnRtcGRpciwgJ1hYWCcpLnJlcGxhY2UoaG9tZWRpciwgJ1hYWCcpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobWVzc2FnZSAmJiBtZXNzYWdlLnRyaW0oKS5yZXBsYWNlKC9cXC4vZywgJycpICE9PSAnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsIG1lc3NhZ2UpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlnUHVibGlzaGVyUHJvY2Vzcy5zdGRlcnIub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBkYXRhLnRvU3RyaW5nKCkucmVwbGFjZSh0bXAudG1wZGlyLCAnWFhYJykucmVwbGFjZShob21lZGlyLCAnWFhYJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtZXNzYWdlICYmIG1lc3NhZ2UudHJpbSgpLnJlcGxhY2UoL1xcLi9nLCAnJykgIT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgbWVzc2FnZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWdQdWJsaXNoZXJQcm9jZXNzLm9uKCdlcnJvcicsIChlcnIpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gJ0Vycm9yIGV4ZWN1dGluZyBGSElSIElHIFB1Ymxpc2hlcjogJyArIGVycjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihtZXNzYWdlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdlcnJvcicsIG1lc3NhZ2UpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWdQdWJsaXNoZXJQcm9jZXNzLm9uKCdleGl0JywgKGNvZGUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgSUcgUHVibGlzaGVyIGlzIGRvbmUgZXhlY3V0aW5nIGZvciAke3Jvb3RQYXRofWApO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdwcm9ncmVzcycsICdJRyBQdWJsaXNoZXIgZmluaXNoZWQgd2l0aCBjb2RlICcgKyBjb2RlKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNvZGUgIT09IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kU29ja2V0TWVzc2FnZSgncHJvZ3Jlc3MnLCAnV29uXFwndCBjb3B5IG91dHB1dCB0byBkZXBsb3ltZW50IHBhdGguJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ2NvbXBsZXRlJywgJ0RvbmUuIFlvdSB3aWxsIGJlIHByb21wdGVkIHRvIGRvd25sb2FkIHRoZSBwYWNrYWdlIGluIGEgbW9tZW50LicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ3Byb2dyZXNzJywgJ0NvcHlpbmcgb3V0cHV0IHRvIGRlcGxveW1lbnQgcGF0aC4nKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFBhdGggPSBwYXRoLnJlc29sdmUocm9vdFBhdGgsICdnZW5lcmF0ZWRfb3V0cHV0Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBwYXRoLnJlc29sdmUocm9vdFBhdGgsICdvdXRwdXQnKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBEZWxldGluZyBjb250ZW50IGdlbmVyYXRlZCBieSBpZyBwdWJsaXNoZXIgaW4gJHtnZW5lcmF0ZWRQYXRofWApO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnMuZW1wdHlEaXIoZ2VuZXJhdGVkUGF0aCwgKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYENvcHlpbmcgb3V0cHV0IGZyb20gJHtvdXRwdXRQYXRofSB0byAke2RlcGxveURpcn1gKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmNvcHkob3V0cHV0UGF0aCwgZGVwbG95RGlyLCAoZXJyKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRTb2NrZXRNZXNzYWdlKCdlcnJvcicsICdFcnJvciBjb3B5aW5nIGNvbnRlbnRzIHRvIGRlcGxveW1lbnQgcGF0aC4nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmluYWxNZXNzYWdlID0gYERvbmUgZXhlY3V0aW5nIHRoZSBGSElSIElHIFB1Ymxpc2hlci4gWW91IG1heSB2aWV3IHRoZSBJRyA8YSBocmVmPVwiL2ltcGxlbWVudGF0aW9uLWd1aWRlLyR7dGhpcy5pbXBsZW1lbnRhdGlvbkd1aWRlSWR9L3ZpZXdcIj5oZXJlPC9hPi5gICsgKGRvd25sb2FkT3V0cHV0ID8gJyBZb3Ugd2lsbCBiZSBwcm9tcHRlZCB0byBkb3dubG9hZCB0aGUgcGFja2FnZSBpbiBhIG1vbWVudC4nIDogJycpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ2NvbXBsZXRlJywgZmluYWxNZXNzYWdlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWRvd25sb2FkT3V0cHV0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYFVzZXIgaW5kaWNhdGVkIHRoZXkgZG9uJ3QgbmVlZCB0byBkb3dubG9hZC4gUmVtb3ZpbmcgdGVtcG9yYXJ5IGRpcmVjdG9yeSAke3Jvb3RQYXRofWApO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5lbXB0eURpcihyb290UGF0aCwgKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYERvbmUgcmVtb3ZpbmcgdGVtcG9yYXJ5IGRpcmVjdG9yeSAke3Jvb3RQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZFNvY2tldE1lc3NhZ2UoJ2Vycm9yJywgJ0Vycm9yIGR1cmluZyBleHBvcnQ6ICcgKyBlcnIpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0ZXN0Q2FsbGJhY2spIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXN0Q2FsbGJhY2socm9vdFBhdGgsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSwgMTAwMCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG59XHJcbiJdfQ==