pipeline {
    agent any
    environment {
        NVM_DIR = "/var/lib/jenkins/.nvm"
        PATH = "/var/lib/jenkins/.nvm/versions/node/v22.15.0/bin:$PATH"
    }
    stages {
        stage('Deploy') {
            steps {
                dir('/var/lib/jenkins/myownai') {
                    sh 'git pull origin main'
                    sh 'pm2 restart server.js'
                }
            }
        }
    }
}
