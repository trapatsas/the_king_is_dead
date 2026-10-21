"""Create an isolated CPU training environment, including Python without ensurepip."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.request import urlopen, urlretrieve
import venv


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venv',default=str(Path(__file__).resolve().parent/'.venv'))
    parser.add_argument('--pip-only',action='store_true')
    args=parser.parse_args()
    target=Path(args.venv).resolve()
    venv.EnvBuilder(with_pip=False).create(target)
    python=target/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    if subprocess.run([str(python),'-m','pip','--version'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        # Bootstrap from a pinned, hash-verified official PyPI wheel, not a shell script.
        with urlopen('https://pypi.org/pypi/pip/26.2.2/json') as response:
            metadata=json.load(response)
        wheel=next(item for item in metadata['urls'] if item['filename'].endswith('.whl'))
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/wheel['filename']
            urlretrieve(wheel['url'],file)
            if hashlib.sha256(file.read_bytes()).hexdigest()!=wheel['digests']['sha256']:
                raise RuntimeError('pip wheel hash mismatch')
            task_env={**os.environ,'PYTHONPATH':str(file)}
            subprocess.run([str(python),'-m','pip','install','pip==26.2.2'],env=task_env,check=True)
    if not args.pip_only:
        subprocess.run([str(python),'-m','pip','install','--extra-index-url','https://download.pytorch.org/whl/cpu','-r',str(Path(__file__).with_name('requirements-lock.txt'))],check=True)
    print(f'Training Python: {python}')


if __name__=='__main__':
    main()
