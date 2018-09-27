/*
*   NOTE: This sample uses ES6 features
*/
import appConfig from './config.js';

// JQuery Alias
const $ = window.$;

/**
 * WizardApp class that handles everything in the App.
 */
class WizardApp {
    constructor(){
        // Reference to the PureCloud App (Client App SDK)
        this.pcApp = null;

        // PureCloud Javascript SDK clients
        this.platformClient = require('platformClient');
        this.purecloudClient = this.platformClient.ApiClient.instance;
        this.purecloudClient.setPersistSettings(true, 'premium_app');
        this.redirectUri = appConfig.redirectUri;

        // PureCloud API instances
        this.usersApi = new this.platformClient.UsersApi();
        this.integrationsApi = new this.platformClient.IntegrationsApi();
        this.groupsApi = new this.platformClient.GroupsApi();
        this.authApi = new this.platformClient.AuthorizationApi();
        this.oAuthApi = new this.platformClient.OAuthApi();

        // Language default is english
        // Language context is object containing the translations
        this.language = 'en-us';

        // PureCloud app name
        this.appName = "premium-app-example";

        this.prefix = appConfig.prefix;
        this.installationData = appConfig.provisioningInfo;
    }

    /**
     * First thing that needs to be called to setup up the PureCloud Client App
     */
    _setupClientApp(){    
        // Snippet from URLInterpolation example: 
        // https://github.com/MyPureCloud/client-app-sdk
        const queryString = window.location.search.substring(1);
        const pairs = queryString.split('&');
        let pcEnv = null;   
        for (var i = 0; i < pairs.length; i++)
        {
            var currParam = pairs[i].split('=');

            if(currParam[0] === 'langTag') {
                this.language = currParam[1];
            } else if(currParam[0] === 'pcEnvironment') {
                pcEnv = currParam[1];
            } else if(currParam[0] === 'environment' && pcEnv === null) {
                pcEnv = currParam[1];
            }
        }

        if(pcEnv){
            this.pcApp = new window.purecloud.apps.ClientApp({pcEnvironment: pcEnv});
        }else{
            // Use default PureCloud region
            this.pcApp = new window.purecloud.apps.ClientApp();
        }
        
        console.log(this.pcApp.pcEnvironment);

        // Get the language context file and assign it to the app
        // For this example, the text is translated on-the-fly.
        return new Promise((resolve, reject) => {
            let fileUri = './languages/' + this.language + '.json';
            $.getJSON(fileUri)
            .done(data => {
                this.displayPageText(data);
                resolve();
            })
            .fail(xhr => {
                console.log('Language file not found.');
                resolve();
            }); 
        });
    }

    /**
     * Authenticate to PureCloud (Implicit Grant)
     * @return {Promise}
     */
    _pureCloudAuthenticate() {
        return this.purecloudClient.loginImplicitGrant(
                        appConfig.clientIDs[this.pcApp.pcEnvironment], 
                        this.redirectUri, 
                        {state: ('pcEnvironment=' + this.pcApp.pcEnvironment)});
    }

    /**
     * Get details of the current user
     * @return {Promise.<Object>} PureCloud User data
     */
    getUserDetails(){
        let opts = {'expand': ['authorization']};
    
        return this.usersApi.getUsersMe(opts);
    }

    /**
     * Checks if the product is available in the current Purecloud org.
     * @return {Promise.<Boolean>}
     */
    validateProductAvailability(){
        // premium-app-example         
        return this.integrationsApi.getIntegrationsTypes({})
        .then((data) => {
            if (data.entities.filter((integType) => integType.id === this.appName)[0]){
                return(true);
            } else {
                return(false);
            }
        });
    }

    /**
     * Checks if any configured objects are still existing. 
     * This is based on the prefix
     * @returns {Promise.<Boolean>} If any installed objects are still existing in the org. 
     */
    isExisting(){
        let promiseArr = []; 
        
        promiseArr.push(this.getExistingGroups());
        promiseArr.push(this.getExistingRoles());
        promiseArr.push(this.getExistingApps());

        return Promise.all(promiseArr)
        .then((results) => { 
            if(
                // Check if any groups are still existing
                results[0].total > 0 || 

                // Check if any roles are existing
                results[1].total > 0 ||

                // Check if any apps are existing
                results[2].length > 0 ){

                return(true);
            }

            return(false);
        });
    }

    /**
     * Get existing roles in purecloud based on prefix
     */
    getExistingRoles(){
        let authOpts = { 
            'name': this.prefix + "*", // Wildcard to work like STARTS_WITH 
            'userCount': false
        };

        return this.authApi.getAuthorizationRoles(authOpts);
    }

    /**
     * Delete existing roles from PureCloud
     * @returns {Promise}
     */
    deletePureCloudRoles(){
        return this.getExistingRoles()
        .then(roles => {
            let del_role = [];

            if(roles.total > 0){
                roles.entities.map(r => r.id).forEach(rid => {
                    del_role.push(this.authApi.deleteAuthorizationRole(rid));
                });
            }
            
            return Promise.all(del_role);
        });
    }

    /**
     * Add PureCLoud roles based on installation data
     * @returns {Promise}
     */
    addRoles(){
        let rolePromises = [];

        // Create the roles
        this.installationData.roles.forEach((role) => {
            let roleBody = {
                    "name": this.prefix + role.name,
                    "description": "",
                    "permissionPolicies": role.permissionPolicies
            };

            // Assign role to user
            let roleId = null;
            rolePromises.push(
                this.authApi.postAuthorizationRoles(roleBody)
                .then((data) => {
                    this.logInfo("Created role: " + role.name);
                    roleId = data.id;

                    return this.getUserDetails();
                })
                .then((user) => {
                    // Assign the role to the user
                    // Required before you can assign the role to an Auth Client.
                    return this.authApi.putAuthorizationRoleUsersAdd(roleId, [user.id]);
                })
                .then((data) => {
                    this.logInfo("Assigned " + role.name + " to user");
                })
                .catch((err) => console.log(err))
            );
        });

        return Promise.all(rolePromises);
    }

    /**
     * Gets the existing groups on PureCloud based on Prefix
     */
    getExistingGroups(){
        // Query bodies
        let groupSearchBody = {
            "query": [
                {
                    "fields": ["name"],
                    "value": this.prefix,
                    "operator": "OR",
                    "type": "STARTS_WITH"
                }
            ]
        };

        return this.groupsApi.postGroupsSearch(groupSearchBody);
    }

    /**
     * Delete existing groups from PureCloud org
     * @returns {Promise}
     */
    deletePureCloudGroups(){
        return this.getExistingGroups()
        .then(groups => {
            let del_group = [];

            if(groups.total > 0){
                groups.results.map(grp => grp.id).forEach(gid => {
                    del_group.push(this.groupsApi.deleteGroup(gid));
                });
            }

            return Promise.all(del_group);
        });
    }

    /**
     * Add PureCLoud groups based on installation data
     * @returns {Promise.<Object>} Group Data Object {"grp-name": "grp-id"}
     */
    addGroups(){
        let groupPromises = [];
        let groupData = {};

        this.installationData.groups.forEach((group) => {
            let groupBody = {
                "name": this.prefix + group.name,
                "description": group.description,
                "type": "official",
                "rulesVisible": true,
                "visibility": "public"
            };
            console.log(groupBody);

            groupPromises.push(
                this.groupsApi.postGroups(groupBody)
                .then((data) => {
                    this.logInfo("Created group: " + group.name);
                    groupData[group.name] = data.id;
                })
                .catch((err) => console.log(err))
            );
        });

        return Promise.all(groupPromises)
        .then(() => groupData);
    }

    /**
     * Get existing apps based on the prefix
     * @returns {Promise}
     */
    getExistingApps(){
        let integrationsOpts = {
            'pageSize': 100
        };
        
        return this.integrationsApi.getIntegrations(integrationsOpts)
        .then((data) => {
            return(data.entities
                .filter(entity => entity.name
                    .startsWith(this.prefix)));
        });  
    }

    /**
     * Delete all existing PremiumApp instances
     * @returns {Promise}
     */
    deletePureCloudApps(){
        return this.getExistingApps()
        .then(apps => {
            console.log(apps);
            let del_app = [];

            if (apps.length > 0){
                // Filter results before deleting
                apps.map(entity => entity.id)
                    .forEach(iid => {
                        del_app.push(this.integrationsApi.deleteIntegration(iid));
                });
            }

            return Promise.all(del_app);
        });
    }

    /**
     * Add PureCLoud instances based on installation data
     * @returns {Promise}
     */
    addInstances(){
        let integrationPromises = [];
        let enableIntegrationPromises = [];

        // After groups are created, create instances
        // There are 3 steps for creating the app instances
        // 1. Create instance of a custom-client-app
        // 2. Configure the app
        // 3. Activate the instances
        this.installationData.appInstances.forEach((instance) => {
            let integrationBody = {
                "body": {
                    "integrationType": {
                        "id": this.appName
                    }
                }
            };

            // Rename and add Group Filtering
            integrationPromises.push(
                this.integrationsApi.postIntegrations(integrationBody)
                .then((data) => {
                    this.logInfo("Created instance: " + instance.name);
                    let integrationConfig = {
                        "body": {
                            "name": this.prefix + instance.name,
                            "version": 1, 
                            "properties": {
                                "url" : instance.url,
                                "sandbox" : "allow-forms,allow-modals,allow-popups,allow-presentation,allow-same-origin,allow-scripts",
                                "displayType": instance.type,
                                "featureCategory": "", 
                                "groupFilter": instance.groups.map((groupName) => groupData[groupName]).filter(g => g != undefined)
                            },
                            "advanced": {},
                            "notes": "",
                            "credentials": {}
                        }
                    };

                    integrationsData.push(data);
                    return this.integrationsApi.putIntegrationConfigCurrent(data.id, integrationConfig);
                })
                .then((data) => {
                    this.logInfo("Configured instance: " + data.name);                           
                })
            );
        });

        return Promise.all(integrationPromises)
        // Activate the newly created application instances
        .then(() => {
            integrationsData.forEach((instance) => {
                let opts = {
                    "body": {
                        "intendedState": "ENABLED"
                    }
                };

                enableIntegrationPromises.push(
                    this.integrationsApi.patchIntegration(instance.id, opts)
                    .then((data) => this.logInfo("Enabled instance: " + data.name))
                    .catch((err) => console.log(err))
                );
            });
            
            return Promise.all(enableIntegrationPromises);
        });
    }

    getExistingAuthClients(){
        return this.integrationsApi.getOauthClients()
        .then((data) => {
            return(data.entities
                .filter(entity => entity.name
                    .startsWith(this.prefix)));
        });
    }

    deleteAuthClients(){
        return this.getExistingAuthClients()
        .then((instances) => {
            let del_clients = [];

            if (instances.length > 0){
                // Filter results before deleting
                instances.map(entity => entity.id)
                    .forEach(cid => {
                        del_clients.push(this.oAuthApi.deleteOauthClient(cid));
                });
            }

            return Promise.all(del_clients);
        });
    }

    addAuthClients(){
        
    }
    
    /**
     * Delete all existing Premium App PC objects
     * @returns {Promise}
     */
    clearConfigurations(){
        let configArr = [];

        configArr.push(this.deletePureCloudGroups());
        configArr.push(this.deletePureCloudRoles());
        configArr.push(this.deletePureCloudApps());

        return Promise.all(configArr);
    }

    /**
     * Final Step of the installation wizard. 
     * Create the PureCloud objects defined in provisioning configuration
     */
    installConfigurations(){
        return this.addRoles()
        .then(() => this.addGroups())
        .then((groupData) => this.addInstances(groupData))

        // When everything's finished, log the output.
        .then(() => {
            this.logInfo("Installation Complete!");
        })
        .catch((err) => console.log(err));
    }

    
    /**
     * Renders the proper text language into the web pages
     * @param {Object} text  Contains the keys and values from the language file
     */
    displayPageText(text){
        $(document).ready(() => {
            for (let key in text){
                if(!text.hasOwnProperty(key)) continue;
                $("." + key).text(text[key]);
            }
        });
    }

    /**
     * Shows an overlay with the specified data string
     * @param {string} data 
     */
    logInfo(data){
        if (!data || (typeof(data) !== 'string')) data = "";

        $.LoadingOverlay("text", data);
    }

    /**
     * @description First thing that must be called to set-up the App
     */
    start(){
        return new Promise((resolve, reject) => {
            this._setupClientApp()
            .then(() => this._pureCloudAuthenticate())
            .then(() => resolve())
            .catch((err) => reject(err));
        });
    }
}


export default WizardApp;