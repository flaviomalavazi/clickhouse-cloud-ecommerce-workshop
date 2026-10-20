# The notebook image: the tools image (psql, the database and Cloud API code) plus JupyterLab.
# Built by `make notebook`; it is not part of `make prefetch` because the workshop does not need it.
FROM clickshop-tools

RUN pip install --no-cache-dir jupyterlab==4.4.9

WORKDIR /workspace/notebooks
EXPOSE 8888
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--ServerApp.token=", "--ServerApp.password=", "--ServerApp.root_dir=/workspace/notebooks"]
